"use strict";

/**
 * Basthon part of the notebook GUI.
 */
window.basthonGUI = (function () {
    let that = {};

    /**
     * Initialise the GUI (Basthon part).
     */
    that.init = async function () {
        await Basthon.Goodies.showLoader("Chargement de Basthon-Notebook...", false);
        requirejs.onError = console.log;

        that.notebook = Jupyter.notebook;
        // avoiding notebook loading failure.
        if( !that.notebook ) {
            location.reload();
        }

        // keeping back events from notebook.
        that.events = that.notebook.events;

        /* all errors redirected to notification system */
        that.connectGlobalErrors();
        
        /*
          loading content from query string or from local storage.
          if global variale basthonEmptyNotebook is set to true,
          we open a new notebook
          (see kernelselector.js).
        */
        Basthon.Goodies.setLoaderText("Chargement du contenu du notebook...");
        if( !window.basthonEmptyNotebook && !await that.loadFromQS() ) {
            that.notebook.loadFromStorage();
        }

        Basthon.Goodies.setLoaderText("Chargement des fichiers auxiliaires...");
        // loading aux files from URL
        await that.loadURLAux();

        Basthon.Goodies.setLoaderText("Chargement des modules annexes...");
        // loading modules from URL
        await that.loadURLModules();

        Basthon.Goodies.hideLoader();

        /* saving to storage on multiple events */
        for( let event of ['execute.CodeCell',
                           'finished_execute.CodeCell',
                           'output_added.OutputArea',
                           'output_updated.OutputArea',
                           'output_appended.OutputArea'] ) {
            that.events.bind(event, () => { that.saveToStorage(); } );
        }
    };

    /**
     * All errors are redirected to notification system.
     */
    that.connectGlobalErrors = function () {
        function onerror(error) {
            // ignoring requirejs error
            if( error.filename && error.filename.split('/').pop() === 'require.js' ) return ;
            const message = error.message || error.reason.message || error;
            Jupyter.dialog.modal({
                notebook: that.notebook,
                keyboard_manager: that.notebook.keyboard_manager,
                title : "Erreur",
                body : message,
                buttons : {
                    OK: {
                        "class": "btn-danger",
                    },
                },
            });
            // In case of error, force loader hiding.
            Basthon.Goodies.hideLoader();
        }
        /* all errors redirected to notification system */
        window.addEventListener('error', onerror);
        window.addEventListener("unhandledrejection", onerror);
        /* console errors redirected to notification system */
        const _error = console.error;
        console.error = function() {
            onerror({message: String(arguments[0])});
            return _error.apply(console, arguments);
        };
    };

    /**
     * Loading the notebook from query string (ipynb= or file=).
     */
    that.loadFromQS = async function () {
        const url = new URL(window.location.href);
        const ipynb_key = 'ipynb';
        const from_key = 'from';
        let ipynb;
        if( url.searchParams.has(ipynb_key) ) {
            ipynb = url.searchParams.get(ipynb_key);
            ipynb = decodeURIComponent(ipynb);
        } else if( url.searchParams.has(from_key) ) {
            let fileURL = url.searchParams.get(from_key);
            fileURL = decodeURIComponent(fileURL);
            try {
                ipynb = await Basthon.xhr({url: fileURL,
                                           method: 'GET'});
            } catch {
                throw {message: "Le chargement du notebook " + fileURL
                       + " a échoué.",
                       name: 'LoadingException'};
            }
        }
        if( ipynb ) {
            that.notebook.load(JSON.parse(ipynb));
            return ipynb;
        }
    };

    /**
     * Load ressources from URL (common part to files and modules).
     */
    that._loadFromURL = async function (key, put) {
        const url = new URL(window.location.href);
        let promises = [];
        for( let fileURL of url.searchParams.getAll(key) ) {
            fileURL = decodeURIComponent(fileURL);
            const filename = fileURL.split('/').pop();
            let promise = Basthon.xhr({method: "GET",
                                       url: fileURL,
                                       responseType: "arraybuffer"});
            promise = promise.then(function (data) {
                return put(filename, data);
            }).catch(function () {
                throw {message: "Impossible de charger le fichier " + filename + ".",
                      name: "LoadingException"};
            });
            promises.push(promise);
        }
        await Promise.all(promises);
    };

    /**
     * Load auxiliary files submited via URL (aux= parameter) (async).
     */
    that.loadURLAux = function () {
        return that._loadFromURL('aux', Basthon.putFile);
    };

    /**
     * Load modules submited via URL (module= parameter) (async).
     */
    that.loadURLModules = function () {
        return that._loadFromURL('module', Basthon.putModule);
    };

    /**
     * Copying a string to clipboard.
     */
    that.copyToClipboard = function (text) {
        
        let textArea = document.createElement("textarea");

        // Precautions from https://stackoverflow.com/questions/400212/how-do-i-copy-to-the-clipboard-in-javascript

        // Place in top-left corner of screen regardless of scroll position.
        textArea.style.position = 'fixed';
        textArea.style.top = 0;
        textArea.style.left = 0;

        // Ensure it has a small width and height. Setting to 1px / 1em
        // doesn't work as this gives a negative w/h on some browsers.
        textArea.style.width = '2em';
        textArea.style.height = '2em';

        // We don't need padding, reducing the size if it does flash render.
        textArea.style.padding = 0;

        // Clean up any borders.
        textArea.style.border = 'none';
        textArea.style.outline = 'none';
        textArea.style.boxShadow = 'none';

        // Avoid flash of white box if rendered for any reason.
        textArea.style.background = 'transparent';


        textArea.value = text;
        
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        try {
            let successful = document.execCommand('copy');
            let msg = successful ? 'successful' : 'unsuccessful';
            console.log('Copying text command was ' + msg);
        } catch (err) {
            console.log('Oops, unable to copy');
        }
        
        document.body.removeChild(textArea);
    };

    /**
     * Open an URL in a new tab.
     */
    that.openURL = function (url) {
        let anchor = document.createElement("a");
        anchor.href = url;
        anchor.target ="_blank";
        anchor.style.display = "none";
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
    };

    /**
     * Sharing notebook via URL.
     */
    that.share = function (key="ipynb") {
        const msg = $("<div>").html(`
<p>
Un lien vers la page de Basthon avec le contenu actuel du notebook a été créé.
<br>
<i class="fa fa-exclamation-circle"></i> Attention, partager un script trop long peut ne pas fonctionner avec certains navigateurs.
`);
        that.events.trigger('before_share.Notebook');
        const url = that.notebook.toURL(key);
        Jupyter.dialog.modal({
            notebook: that.notebook,
            keyboard_manager: that.notebook.keyboard_manager,
            title : "Partager ce notebook",
            body : msg,
            buttons : {
                "Copier dans le presse-papier": {
                    "class": "btn-primary",
                    "click": function () {
                        that.copyToClipboard(url);
                    },
                },
                "Tester le lien": {
                    "click": function () {
                        that.openURL(url);
                    },
                },
            }
        });
        that.events.trigger('notebook_shared.Notebook');
    };

    /**
     * Saving notebook to local storage.
     */
    that.saveToStorage = function () {
        that.notebook.saveToStorage();
    };

    /**
     * Download notebook to file.
     */
    that.download = function () {
        const content = JSON.stringify(that.notebook.toJSON());
        let blob = new Blob([content], { type: "text/plain" });
        let anchor = document.createElement("a");
        anchor.download = that.notebook.notebook_name;
        anchor.href = window.URL.createObjectURL(blob);
        anchor.target ="_blank";
        anchor.style.display = "none"; // just to be safe!
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
    };
    
    /**
     * Load a notebook.
     */
    that.openNotebook = function (file) {
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();
            reader.readAsText(file);
            reader.onload = async function (event) {
                /* TODO: connect filename to notebook name */
                await that.notebook.load(JSON.parse(event.target.result));
                // notification seems useless here.
                resolve();
            };
            reader.onerror = reject;
        });
    };

    /**
     * Load the content of a Python script in first cell.
     */
    that.loadPythonInCell = function(file) {
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();
            reader.readAsText(file);
            reader.onload = async function (event) {
                const new_cell = that.notebook.insert_cell_above('code', 0);
                new_cell.set_text(event.target.result);
                // notification seems useless here.
                resolve();
            };
            reader.onerror = reject;
        });
    };

    /**
     * Open *.py file by asking user what to do:
     * load in notebook cell or put on (emulated) local filesystem.
     */
    that.openPythonFile = async function (file) {
        const msg = $("<div>").html(
            "Que faire de " + file.name + " ?");
        Jupyter.dialog.modal({
            notebook: that.notebook,
            keyboard_manager: that.notebook.keyboard_manager,
            title : "Que faire du fichier ?",
            body : msg,
            buttons : {
                "Charger dans le notebook": {
                    "class": "btn-primary",
                    "click": () => { that.loadPythonInCell(file); },
                },
                "Installer le module": {
                    "class": "btn-primary",
                    "click": () => { that.putFSRessource(file); },
                },
            }
        });
    };

    /**
     * Loading file in the (emulated) local filesystem (async).
     */
    that.putFSRessource = function (file) {
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();
            reader.readAsArrayBuffer(file);
            reader.onload = async function (event) {
                await Basthon.putRessource(file.name, event.target.result);
                const msg = $("<div>").html(
                    file.name + " est maintenant utilisable depuis Python");
                Jupyter.dialog.modal({
                    notebook: that.notebook,
                    keyboard_manager: that.notebook.keyboard_manager,
                    title : "Fichier utilisable depuis Python",
                    body : msg,
                    buttons : {
                        OK: {
                            "class": "btn-primary",
                        },
                    }
                });
                resolve();
            };
            reader.onerror = reject;
        });
    };

    /**
     * Opening file: If it has .ipynb extension, load the notebok,
     * if it has .py extension, loading it in the first cell
     * or put on (emulated) local filesystem (user is asked to),
     * otherwise, loading it in the local filesystem.
     */
    that.openFile = function () {
        return new Promise(function (resolve, reject) {
            let input = document.createElement('input');
            input.type = 'file';
            input.style.display = "none";
            input.onchange = async function (event) {
                for( let file of event.target.files ) {
                    const ext = file.name.split('.').pop();
                    if(ext === 'ipynb') {
                        await that.openNotebook(file);
                    } else if(ext === 'py') {
                        await that.openPythonFile(file);
                    } else {
                        await that.putFSRessource(file);
                    }
                }
                resolve();
            };
            input.onerror = reject;
            document.body.appendChild(input);
            input.click();
            document.body.removeChild(input);
        });
    };
    
    return that;
})();

window.basthonGUI.init();
