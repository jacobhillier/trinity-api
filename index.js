var express = require('express');
var mongo = require('mongodb');
var assert = require('assert');

var mongoUrl = 'mongodb://trinity-cms:tr1n1ty@dbh44.mongolab.com:27447/trinity';
var MongoClient = mongo.MongoClient;
var ObjectId = mongo.ObjectId;

var app = express();
app.set('port', (process.env.PORT || 5000));

app.get('/api/v1/:contentTypeUri/:contentId', function (request, response) {
    var findContentType = function (db, callback) {
        var collection = db.collection('contentType');

        collection.findOne({uri: request.params.contentTypeUri}, function (err, document) {
            assert.equal(err, null);
            callback(document);
        });
    };

    var findContent = function (contentType, db, callback) {
        var collection = db.collection('content');

        collection.findOne({_id: ObjectId(request.params.contentId)}, function (err, document) {
            assert.equal(err, null);
            if (document.type == contentType._id) {
                var transformedContent = {};
                transformedContent.id = document._id;
                transformedContent.type = contentType.uri;
                transformedContent.meta = { href: request.protocol + "://" + request.headers.host + "/api/v1/" + contentType.uri + "/" + document._id };

                for (var i in contentType.fields) {
                    var fieldName = contentType.fields[i].name;
                    if (contentType.fields[i].apiFull) {
                        transformedContent[fieldName] = document.fields[fieldName];
                    }
                }

                response.send(transformedContent);
            } else {
                response.status(404).send('Not found');
            }

            callback();
        });
    };

    MongoClient.connect(mongoUrl, function (err, db) {
        assert.equal(null, err);

        findContentType(db, function (contentType) {
            findContent(contentType, db, function () {
                db.close();
            });
        });
    });
});

app.listen(app.get('port'), function () {
    console.log("Node app is running at localhost:" + app.get('port'));
});
