var express = require('express');
var mongo = require('mongodb');
var assert = require('assert');
var array = require('array');

var mongoUrl = 'mongodb://trinity-cms:tr1n1ty@dbh44.mongolab.com:27447/trinity';
var MongoClient = mongo.MongoClient;
var ObjectId = mongo.ObjectId;

var app = express();
app.set('port', (process.env.PORT || 5000));

app.get('/api/v1/:contentTypeUri/:contentId', function (request, response) {
    var findContent = function (id, transformType, failOnNotFound, db, callback) {
        // console.log('Finding content [%s]', id);
        var collection = db.collection('content');

        collection.findOne({_id: ObjectId(id)}, function (err, content) {
            assert.equal(err, null);

            if (content) {
                callback(content, transformType);
            } else if (failOnNotFound) {
                sendNotFound(db);
            }
        });
    };

    var transformContent = function (content, transformType, db, callback) {
        findContentType(content.type, db, function (contentType) {
                var transformedContent = {
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

                callback(content, contentType, transformedContent, transformType);
            }
        )
        ;
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

    var findContentType = function (id, db, callback) {
        // console.log('Finding content type [%s]', id);
        var collection = db.collection('contentType');

        collection.findOne({_id: ObjectId(id)}, function (err, contentType) {
            assert.equal(err, null);

            callback(contentType);
        });
    };

    var findAssociatedContent = function (content, contentType, transformedContent, transformType, db, callback) {
        var contentIds = extractUniqueAssociationIds(content, contentType, transformType);
        if (contentIds.length > 0) {
            var transformedAssociatedContent = [];
            contentIds.each(function (id) {
                findContent(id, 'apiTeaser', false, db, function (associatedContent, type) {
                    transformContent(associatedContent, type, db, function (associatedContent, associatedContentType, associatedTransformedContent) {
                        transformedAssociatedContent.push(associatedTransformedContent);
                        if (transformedAssociatedContent.length == contentIds.length) {
                            populateAssociatedContent(content, transformedContent, contentType, transformedAssociatedContent, transformType, callback);
                        }
                    });
                });
            });
        } else {
            callback(transformedContent);
        }
    };

    var extractUniqueAssociationIds = function (content, contentType, transformType) {
        var contentIds = array();

        array(contentType.fields).each(function (field) {
            if (field[transformType]) {
                if (isAssociationField(field)) {
                    contentIds.push(content.fields[field._id]._id);
                } else if (isListAssociationField(field)) {
                    array(content.fields[field._id].associations).each(function (association) {
                        contentIds.push(association._id);
                    });
                }
            }
        });

        return contentIds.unique();
    };

    var populateAssociatedContent = function (content, transformedContent, contentType, transformedAssociatedContent, transformType, callback) {
        var associatedContentForId = function (id) {
            return array(transformedAssociatedContent).find(function (transformedAssociatedContent) {
                return transformedAssociatedContent.id == id.toHexString();
            });
        };

        array(contentType.fields).each(function (field) {
            if (field[transformType]) {
                if (isAssociationField(field)) {
                    var id = content.fields[field._id]._id;
                    if (id) {
                        transformedContent[field.name] = associatedContentForId(id);
                    }
                } else if (isListAssociationField(field)) {
                    array(content.fields[field._id].associations).each(function (association) {
                        if (association._id) {
                            if (!transformedContent[field.name]) {
                                transformedContent[field.name] = [];
                            }

                            transformedContent[field.name].push(associatedContentForId(association._id));
                        }
                    });
                }
            }
        });

        callback(transformedContent);
    };

    var sendNotFound = function (db) {
        response.sendStatus(404);
        response.send('Not found');
        db.close();
    };

    MongoClient.connect(mongoUrl, function (err, db) {
        assert.equal(null, err);

        findContent(request.params.contentId, 'apiFull', true, db, function (content, transformType) {
            transformContent(content, transformType, db, function (content, contentType, transformedContent, transformType) {
                findAssociatedContent(content, contentType, transformedContent, transformType, db, function (transformedContent) {
                    response.send(transformedContent);
                    db.close();
                });
            })
        });
    });
});

app.listen(app.get('port'), function () {
    console.log("Node app is running at localhost:" + app.get('port'));
});