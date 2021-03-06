define([], function() {
    "use strict";

    let CLOSED = 0;
    let OPEN = 1;

    /**
     * DOM node variable exchanger (Bus) to bypass stringifying
     * messages between frontend and kernel that prevents DOMNode sharing.
     */
    let domNodeBus = window.domNodeBus = (function() {
        let that = {};

        /**
         * The actual bus is a dict.
         */
        that._bus = {};

        /**
         * Pushing a variable to the bus and getting an id to pop it.
         */
        that.push = function (obj) {
            let id = 0;
            for( ; id < that._bus.length; id++) {
                if( !(id in that._bus) ) {
                    break;
                }
            }
            that._bus[id] = obj;
            return id;
        };

        /**
         * Removing a variable from the bus from its id.
         */
        that.pop = function (id) {
            const res = that._bus[id];
            delete that._bus[id];
            return res;
        };

        return that;
    })();

    /**
     * Evaluation queue (FIFO).
     */
    let evalQueue = (function () {
        let that = {};

        /**
         * The queue.
         */
        that._queue = [];

        /**
         * Ready state.
         */
        that.ready = true;

        /**
         * Pushing an eval to the queue.
         */
        that.push = function (data) {
            that._queue.push(data);
            if( that.ready ) {
                that.popAndRun();
            }
            return data;
        };

        /**
         * Poping an eval from the queue.
         */
        that.pop = function () {
            return that._queue.shift();
        };

        /**
         * Pop data and run it.
         */
        that.popAndRun = function () {
            const data = that.pop();
            if( data ) {
                Basthon.dispatchEvent("eval.request", data);
                that.ready = false;
            } else {
                that.ready = true;
            }
            return data;
        };

        return that;
    })();

    /**
     * A fake interface to WebSocket to simulate communication with
     * Python kernel.
     */
    let BasthonWebSocket = function(url) {
        let that = this;

        this.url = url;
        this.onopen = null;
        this.onclose = null;
        this.onerror = null;
        this.onmessage = null;
        this.readyState = OPEN;

        setTimeout(function() {
            that.onopen();
        }, 500);

        /* send finished signal to kernel and run next eval */
        function sendFinishedAndContinue(data) {
            that._send({
                content: {
                    execution_count: data.execution_count,
                    metadata: {}
                },
                header: { msg_type: "execute_reply" },
                parent_header: { msg_id: data.parent_id },
                channel: "shell"
            });

            evalQueue.popAndRun();
        }

        Basthon.addEventListener(
            'eval.finished',
            function (data) {
                // updating output
                if("result" in data) {
                    that._send({
                        content: {
                            execution_count: data.execution_count,
                            data: data.result,
                            metadata: {}
                        },
                        header: { msg_type: "execute_result" },
                        parent_header: { msg_id: data.parent_id },
                        channel: "iopub"
                    });
                }

                sendFinishedAndContinue(data);
            });

        Basthon.addEventListener('eval.error', sendFinishedAndContinue);

        Basthon.addEventListener(
            'eval.output',
            function (data) {
                that._send({
                    content: {
                        name: data.stream,
                        text: data.content
                    },
                    header: { msg_type: "stream" },
                    parent_header: { msg_id: data.parent_id },
                    channel: "iopub"
                });
            });

        Basthon.addEventListener(
            'eval.display',
            function (data) {
                /* see outputarea.js to understand interaction */
                let send_data;
                switch( data.display_type ) {
                case "html":
                    send_data = { "text/html": data.content };
                    break;
                case "sympy":
                    send_data = { "text/latex": data.content };
                    break;
                case "turtle":
                    const root = data.content;
                    root.setAttribute('width', '480px');
                    root.setAttribute('height', '360px');
                    send_data = { "image/svg+xml": root.outerHTML };
                    break;
                case "matplotlib":
                case "p5":
                    /* /!\ big hack /!\
                       To allow javascript loading of DOM node,
                       we get an id identifying the object. We can then
                       pickup the object from its id.
                     */
                    const id = domNodeBus.push(data.content);
                    send_data = { "application/javascript": "element.append(window.domNodeBus.pop(" + id + "));" };
                    break;
                case "multiple":
                    /* typically dispached by display() */
                    send_data = data.content;
                    break;
                default:
                    console.error("Not recognized display_type: " + data.display_type);
                }

                that._send({
                    content: {
                        data: send_data,
                        metadata: {},
                        transcient: {},
                    },
                    header: { msg_type: "display_data" },
                    parent_header: { msg_id: data.parent_id },
                    channel: "iopub"
                });
            });
    };

    BasthonWebSocket.prototype._send = function (data) {
        this.onmessage({"data": JSON.stringify(data)});
    }

    BasthonWebSocket.prototype.send = function (msg) {
        msg = JSON.parse(msg);

        let header = msg.header;
        let channel = msg.channel;
        let msg_type = header.msg_type;

        switch(channel) {
        case "shell":
            switch(msg_type) {
            case "kernel_info_request":
                this._send({"header":
                            {"msg_id": "",
                             "msg_type": "status",
                             "username": "",
                             "session": "",
                             "date": "",
                             "version": ""},
                            "msg_id": "",
                            "msg_type": "status",
                            "parent_header": header,
                            "metadata": {},
                            "content": {"execution_state": "busy"},
                            "buffers": [],
                            "channel": "iopub"});
                this._send({"header":
                            {"msg_id": "",
                             "msg_type": "status",
                             "username": "",
                             "session": "",
                             "date": "",
                             "version": ""},
                            "msg_id": "",
                            "msg_type": "status",
                            "parent_header": header,
                            "metadata": {},
                            "content": {"execution_state": "idle"},
                            "buffers": [],
                            "channel": "iopub"});
                this._send({"header":
                            {"msg_id": "",
                             "msg_type": "kernel_info_reply",
                             "username": "",
                             "session": "",
                             "date": "",
                             "version": ""},
                            "msg_id": "",
                            "msg_type": "kernel_info_reply",
                            "parent_header": header,
                            "metadata": {},
                            "content": {"status": "ok"},
                            "buffers": [],
                            "channel": "shell"});
                break;
            case "execute_request":
                let code = msg.content.code;
                let parent_id = header.msg_id;
                evalQueue.push({"code": code, "parent_id": parent_id});
                break;
            }
            break;
        case "iopub":
            break;
        }
    };

    BasthonWebSocket.prototype.close = function () {
        if( this.onclose ) {
            this.onclose();
        }
    };

    return {'BasthonWebSocket': BasthonWebSocket,
            'BasthonWebSocket.CLOSED': CLOSED,
            'BasthonWebSocket.OPEN': OPEN};

});
