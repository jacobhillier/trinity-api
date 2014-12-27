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

var findContentType = function (criteria, failOnNotFound, db, callback) {
    log.debug('findContentType <%j>', criteria);

    var collection = db.collection('contentType');

    collection.findOne(criteria, function (err, contentType) {
        assert.equal(err, null);

        if (contentType) {
            callback(contentType, failOnNotFound);
        } else if (failOnNotFound) {
            sendNotFound(db);
        }
    });
};

var findContent = function (id, contentType, failOnNotFound, db, callback) {
    log.debug('findContent <%s>, <%j>, <%s>', id, contentType, failOnNotFound);

    var collection = db.collection(pickContentCollection(contentType));

    collection.findOne({_id: ObjectId(id)}, function (err, content) {
        assert.equal(err, null);

        if (failOnNotFound && (!content || content.type != contentType._id)) {
            sendNotFound(db);
        }

        callback(content, contentType);
    });
};

var pickContentCollection = function (contentType) {
    return contentType.publishable ? 'publishedContent' : 'content';
};

var transformContent = function (content, contentType, transformType, request, db, callback) {
    log.debug('transformContent <%j>, <%j>, <%s>', content, contentType, transformType);

    var transformedContent;
    if (content) {
        transformedContent = {
            id: content._id,
            type: contentType.uri,
            meta: {
                href: request.protocol + "://" + request.headers.host + "/api/v1/" + contentType.uri + "/" + content._id
            }
        };

        array(contentType.fields).each(function (field) {
            if (field[transformType] && isTextField(field)) {
                transformedContent[field.name] = content.fields[field._id].value;
            }
        });
    }

    callback(content, transformedContent, contentType, transformType, request);
};

var isTextField = function (field) {
    return field._class == 'trinity.field.TextField';
};

var isAssociationField = function (field) {
    return field._class == 'trinity.field.AssociationField';
};

var isListAssociationField = function (field) {
    return field._class == 'trinity.field.ListAssociationField';
};

var findAssociatedContent = function (content, transformedContent, contentType, transformType, request, db, callback) {
    log.debug('findAssociatedContent <%j>, <%j>', content, transformType);

    var contentIds = extractUniqueAssociations(content, contentType, transformType);
    if (contentIds.length > 0) {
        var callbackCount = 0;
        var associatedTransformedContents = array();
        contentIds.each(function (association) {
            findContentType({_id: ObjectId(association.contentType)}, false, db, function (associatedContentType, failOnNotFound) {
                findContent(association._id, associatedContentType, failOnNotFound, db, function (associatedContent, associatedContentType) {
                    transformContent(associatedContent, associatedContentType, 'apiTeaser', request, db, function (associatedContent, associatedTransformedContent, associatedContentType, associatedTransformType, request) {
                        findAssociatedContent(associatedContent, associatedTransformedContent, associatedContentType, associatedTransformType, request, db, function (associatedTransformedContent) {
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
};

var extractUniqueAssociations = function (content, contentType, transformType) {
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
};

var populateAssociatedContent = function (content, transformedContent, contentType, associatedTransformedContents, transformType) {
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
};

var sendNotFound = function (db) {
    response.sendStatus(404);
    response.send('Not found');
    db.close();
};

app.get('/api/v1/:contentTypeUri/:contentId', function (request, response) {
    MongoClient.connect(mongoUrl, function (err, db) {
        assert.equal(null, err);

        findContentType({uri: request.params.contentTypeUri}, true, db, function (contentType, failOnNotFound) {
            findContent(request.params.contentId, contentType, failOnNotFound, db, function (content, contentType) {
                transformContent(content, contentType, 'apiFull', request, db, function (content, transformedContent, contentType, transformType, request) {
                    findAssociatedContent(content, transformedContent, contentType, transformType, request, db, function (transformedContent) {
                        response.send(transformedContent);
                        db.close();
                    });
                });
            });
        });
    });
});

app.listen(app.get('port'), function () {
    console.log("Node app is running at localhost:" + app.get('port'));
});