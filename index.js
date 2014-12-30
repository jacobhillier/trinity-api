var express = require('express');
var mongo = require('mongodb');
var assert = require('assert');
var array = require('array');
var log = require('loglevel');

var mongoUrl = 'mongodb://trinity-cms:tr1n1ty@dbh44.mongolab.com:27447/trinity';
var MongoClient = mongo.MongoClient;
var ObjectId = mongo.ObjectId;

log.setLevel('info');

var app = express();
app.set('port', (process.env.PORT || 5000));

function Trinity(request, response, db) {
    return ({
        findTransformedContents: findTransformedContents,
        findTransformedContent: findTransformedContent
    });

    function findTransformedContents(contentTypeUri) {
        findContentType({uri: contentTypeUri}, true, function (contentType) {
            if (contentType.apiList) {
                findContents(contentType, function (contents) {
                    var callbackCount = 0;
                    var transformedContents = array();

                    array(contents).each(function (content) {
                        transformContent(content, contentType, 'apiTeaser', function (content, transformedContent, contentType, transformType) {
                            findAssociatedContent(content, transformedContent, contentType, transformType, function (transformedContent) {
                                transformedContents.push(transformedContent);

                                if (++callbackCount == contents.length) {
                                    response.send(transformedContents.compact());
                                    db.close();
                                }
                            });
                        });
                    });
                });
            } else {
                sendNotFound();
            }
        });
    }

    function findTransformedContent(contentTypeUri, contentId) {
        findContentType({uri: contentTypeUri}, true, function (contentType, failOnNotFound) {
            findContent(contentId, contentType, failOnNotFound, function (content, contentType) {
                transformContent(content, contentType, 'apiFull', function (content, transformedContent, contentType, transformType) {
                    findAssociatedContent(content, transformedContent, contentType, transformType, function (transformedContent) {
                        response.send(transformedContent);
                        db.close();
                    });
                });
            });
        });
    }

    function findContentType(criteria, failOnNotFound, callback) {
        log.debug('findContentType <%j>', criteria);

        var collection = db.collection('contentType');

        collection.findOne(criteria, function (err, contentType) {
            assert.equal(err, null);

            if (contentType) {
                callback(contentType, failOnNotFound);
            } else if (failOnNotFound) {
                sendNotFound();
            }
        });
    }

    function findContent(id, contentType, failOnNotFound, callback) {
        log.debug('findContent <%s>, <%j>, <%s>', id, contentType, failOnNotFound);

        var collection = db.collection(pickContentCollection(contentType));

        collection.findOne({_id: ObjectId(id)}, function (err, content) {
            assert.equal(err, null);

            if (failOnNotFound && (!content || content.type != contentType._id)) {
                sendNotFound();
            }

            callback(content, contentType);
        });
    }

    function findContents(contentType, callback) {
        log.debug('findContents <%j>', contentType);

        var collection = db.collection(pickContentCollection(contentType));

        collection.find({type: contentType._id.toHexString()}).toArray(function (err, contents) {
            assert.equal(err, null);

            callback(contents);
        });
    }

    function pickContentCollection(contentType) {
        return contentType.publishable ? 'publishedContent' : 'content';
    }

    function transformContent(content, contentType, transformType, callback) {
        log.debug('transformContent <%j>, <%j>, <%s>', content, contentType, transformType);

        var transformedContent;
        if (content) {
            transformedContent = {
                id: content._id,
                type: contentType.uri,
                meta: {
                    href: createUrl(contentType, content)
                }
            };

            array(contentType.fields).each(function (field) {
                if (field[transformType] && isTextField(field)) {
                    transformedContent[field.name] = content.fields[field._id].value;
                }
            });
        }

        callback(content, transformedContent, contentType, transformType);
    }

    function createUrl(contentType, content) {
        return request.protocol + "://" + request.headers.host + "/api/v1/" + contentType.uri + "/" + content._id;
    }

    function isTextField(field) {
        return field._class == 'trinity.field.TextField';
    }

    function isAssociationField(field) {
        return field._class == 'trinity.field.AssociationField';
    }

    function isListAssociationField(field) {
        return field._class == 'trinity.field.ListAssociationField';
    }

    function findAssociatedContent(content, transformedContent, contentType, transformType, callback) {
        log.debug('findAssociatedContent <%j>, <%j>', content, transformType);

        var contentIds = extractUniqueAssociations(content, contentType, transformType);
        if (contentIds.length > 0) {
            var callbackCount = 0;
            var associatedTransformedContents = array();
            contentIds.each(function (association) {
                findContentType({_id: ObjectId(association.contentType)}, false, function (associatedContentType, failOnNotFound) {
                    findContent(association._id, associatedContentType, failOnNotFound, function (associatedContent, associatedContentType) {
                        transformContent(associatedContent, associatedContentType, 'apiTeaser', function (associatedContent, associatedTransformedContent, associatedContentType, associatedTransformType) {
                            findAssociatedContent(associatedContent, associatedTransformedContent, associatedContentType, associatedTransformType, function (associatedTransformedContent) {
                                associatedTransformedContents.push(associatedTransformedContent);

                                if (++callbackCount == contentIds.length) {
                                    populateAssociatedContent(content, transformedContent, contentType, associatedTransformedContents.compact(), transformType);

                                    callback(transformedContent);
                                }
                            });
                        });
                    });
                });
            });
        } else {
            callback(transformedContent);
        }
    }

    function extractUniqueAssociations(content, contentType, transformType) {
        log.debug('extractUniqueAssociationIds <%j>, <%j>, <%s>', content, contentType, transformType);

        var contentIds = array();

        if (content) {
            array(contentType.fields).each(function (field) {
                if (field[transformType] && content.fields[field._id]) {
                    if (isAssociationField(field)) {
                        contentIds.push(content.fields[field._id]);
                    } else if (isListAssociationField(field)) {
                        array(content.fields[field._id].associations).each(function (association) {
                            contentIds.push(association);
                        });
                    }
                }
            });
        }

        return contentIds.unique();
    }

    function populateAssociatedContent(content, transformedContent, contentType, associatedTransformedContents, transformType) {
        log.debug('populateAssociatedContent <%j>, <%j>, <%j>, <%j>, <%s>', content, transformedContent, contentType, associatedTransformedContents, transformType);

        var associatedContentForId = function (id) {
            return associatedTransformedContents.find(function (transformedAssociatedContent) {
                return id && transformedAssociatedContent.id == id.toHexString();
            });
        };

        array(contentType.fields).each(function (field) {
            if (field[transformType]) {
                if (isAssociationField(field)) {
                    var id = content.fields[field._id]._id;
                    if (id) {
                        var associatedContent = associatedContentForId(id);

                        if (associatedContent) {
                            transformedContent[field.name] = associatedContent;
                        }
                    }
                } else if (isListAssociationField(field)) {
                    array(content.fields[field._id].associations).each(function (association) {
                        if (association._id) {
                            var associatedContent = associatedContentForId(association._id);

                            if (associatedContent) {
                                if (!transformedContent[field.name]) {
                                    transformedContent[field.name] = [];
                                }

                                transformedContent[field.name].push(associatedContent);
                            }
                        }
                    });
                }
            }
        });
    }

    function sendNotFound() {
        response.sendStatus(404);
        response.send('Not found');
        db.close();
    }
}

app.get('/api/v1/:contentTypeUri', function (request, response) {
    MongoClient.connect(mongoUrl, function (err, db) {
        assert.equal(null, err);

        new Trinity(request, response, db).findTransformedContents(request.params.contentTypeUri);
    });
});

app.get('/api/v1/:contentTypeUri/:contentId', function (request, response) {
    MongoClient.connect(mongoUrl, function (err, db) {
        assert.equal(null, err);

        new Trinity(request, response, db).findTransformedContent(request.params.contentTypeUri, request.params.contentId);
    });
});

app.listen(app.get('port'), function () {
    console.log("Node app is running at localhost:" + app.get('port'));
});