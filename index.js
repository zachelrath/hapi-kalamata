var bodyParser = require('body-parser');
var app, options;

var kalamata = module.exports = function(_app_, _options_) {
    app = _app_;
    options = _options_;

    app.use(bodyParser.json());

    if(!options) options = {};
    if(!options.apiRoot) options.apiRoot = '/';
    else options.apiRoot = '/' + options.apiRoot.replace(/^\/|\/$/g, '') + '/';

    return kalamata;
};

kalamata.expose = function(model, _opts_) {

    var validOpts = {
        identifier: true,
        endpointName: true
    };

    var hooks = {
        before: hookArrays(),
        after: hookArrays()
    };

    var opts = {};
    for(var p in _opts_) {
        if(validOpts[p]) {
            opts[p] = _opts_[p];
        } else {
            throw new Error(
                'Invalid option for endpoint ' +
                opts.endpointName + ': ' + p
            );
        }
    }
    if(!opts.identifier) opts.identifier = 'id';
    if(!opts.endpointName) opts.endpointName = model.forge().tableName;

    var chainer = {};
    addHookChainers('before', chainer);
    addHookChainers('after', chainer);

    configureEndpoints();

    function configureEndpoints() {

        app.get(options.apiRoot + opts.endpointName, function(req, res) {
            var m;
            if(req.query.where) {
                var w;
                try {
                    w = parseJSON(req.query.where);
                } catch(err) {
                    console.log(err.stack);
                    res.send('Error parsing JSON. \'' +
                                req.query.where + '\' is not valid JSON');
                    return;
                }
                m = new model().where(w);
            } else {
                m = new model();
            }

            var beforeResult = runHooks(hooks.before.getCollection, req, res, m);
            if(res.headersSent) return;

            var promise = beforeResult.promise || m.fetchAll();
            promise.then(function(collection) {
                var afterResult = runHooks(
                                    hooks.after.getCollection, req, res, collection);
                return afterResult.promise || collection;
            }).then(function(collection) {
                sendResponse(res, collection.toJSON());
            }).catch(function(error) {
                console.log(error.stack);
                res.send('Error getting ' + opts.endpointName);
            });
        });

        app.get(options.apiRoot + opts.endpointName + '/:identifier',
        function(req, res) {
            var modelAttrs = {};
            modelAttrs[opts.identifier] = req.params.identifier;
            var m = new model(modelAttrs);

            var beforeResult = runHooks(hooks.before.get, req, res, m);
            if(res.headersSent) return;

            var promise = beforeResult.promise || m.fetch();
            promise.then(function(m) {
                if(!m) {
                    throw new Error(
                        'Error getting ' + opts.endpointName + '. ' +
                        opts.identifier + ' = ' + req.params.identifier +
                        ' not found'
                    );
                }
                var afterResult = runHooks(hooks.after.get, req, res, m);
                return afterResult.promise || m;
            }).then(function(m) {
                sendResponse(res, m);
            }).catch(function(error) {
                console.log(error.stack);
                res.send('Error getting ' + opts.endpointName);
            });
        });

        app.post(options.apiRoot + opts.endpointName, function(req, res) {
            var m = new model(req.body);

            var beforeResult = runHooks(hooks.before.create, req, res, m);
            if(res.headersSent) return;

            var promise = beforeResult.promise || m.save();
            promise.then(function(m) {
                var afterResult = runHooks(hooks.after.create, req, res, m);
                return afterResult.promise || m;
            }).then(function(m) {
                sendResponse(res, m.toJSON());
            }).catch(function(error) {
                console.log(error.stack);
                res.send(
                    'Error saving ' + opts.endpointName + ' ' +
                    JSON.stringify(req.body)
                );
            });
        });

        app.put(options.apiRoot + opts.endpointName + '/:identifier',
        function(req, res) {
            var modelAttrs = {};
            modelAttrs[opts.identifier] = req.params.identifier;
            new model(modelAttrs).fetch().then(function(m) {

                if(m) m.set(req.body);
                var beforeResult = runHooks(hooks.before.update, req, res, m);
                if(res.headersSent) return;

                if(!m) {
                    throw new Error(
                        'Error updating ' + opts.endpointName + '. ' +
                        opts.identifier + ' = ' + req.params.identifier +
                        ' not found'
                    );
                }

                return beforeResult.promise || m.save();
            })
            .then(function(m) {
                if(!m) return;
                var afterResult = runHooks(hooks.after.update, req, res, m);
                return afterResult.promise || m;
            }).then(function(m) {
                if(!m) return;
                sendResponse(res, m.toJSON());
            }).catch(function(error) {
                console.log(error.stack);
                res.send('Error getting ' + opts.endpointName);
            });
        });

        app.delete(options.apiRoot + opts.endpointName + '/:identifier',
        function(req, res) {
            var modelAttrs = {};
            modelAttrs[opts.identifier] = req.params.identifier;
            new model(modelAttrs).fetch().then(function(m) {

                var beforeResult = runHooks(hooks.before.del, req, res, m);
                if(res.headersSent) return;

                if(!m) {
                    throw new Error(
                        'Error deleting ' + opts.endpointName + '. ' +
                        opts.identifier + ' = ' + req.params.identifier +
                        ' not found'
                    );
                }

                return beforeResult.promise || m.destroy();
            })
            .then(function(m) {
                var afterResult = runHooks(hooks.after.del, req, res, m);
                return afterResult.promise || m;
            }).then(function(m) {
                sendResponse(res, true);
            }).catch(function(error) {
                console.log(error.stack);
                res.send('Error deleting ' + opts.endpointName);
            });
        });
    }

    function runHooks(fnArray, req, res, model, result) {
        try {
            var result;
            for(var i in fnArray) {
                result = fnArray[i](req, res, model, result);
            }
            if(result && result.then) {
                return {
                    promise: result
                };
            } else {
                return {};
            }
        } catch(err) {
            console.log(err.stack);
            res.send('Error getting ' + opts.endpointName);
            return true;
        }
    }

    function hookArrays() {
        return {
            get: [],
            getCollection: [],
            create: [],
            update: [],
            del: []
        };
    }

    function addHookChainers(prefix, chainerObj) {
        chainerObj[prefix] = hookFn(prefix);
        chainerObj[prefix + 'Get'] = hookFn(prefix, 'get');
        chainerObj[prefix + 'GetCollection'] = hookFn(prefix, 'getCollection');
        chainerObj[prefix + 'Create'] = hookFn(prefix, 'create');
        chainerObj[prefix + 'Update'] = hookFn(prefix, 'update');
        chainerObj[prefix + 'Delete'] = hookFn(prefix, 'del');
    }

    function hookFn(prefix, type) {
        if(type) {
            return function(fn) {
                hooks[prefix][type].push(fn);
                return chainer;
            };
        } else {
            return function(fn) {
                for(var i in hooks[prefix]) {
                    hooks[prefix][i].push(fn);
                }
                return chainer;
            };
        }
    }

    function sendResponse(response, sendData) {
        if(!response.headersSent) response.send(sendData);
    }

    function parseJSON(str) {
        return JSON.parse(fixJSONString(str));
    }

    function fixJSONString(str) {
        return str.replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2": ');
    }

    return chainer;

};