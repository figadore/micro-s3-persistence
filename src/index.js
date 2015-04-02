var express = require('express');
var aws = require('aws-sdk');
var path = require('path');
var fs = require('fs');
var zlib = require('zlib');
var tar = require('tar-fs');
var rmdir = require('rimraf');
var Stream = require('stream');

var app = express();
var s3 = new aws.S3();
var bucket = process.env.S3_BUCKET_NAME;

/**
 * This API provides a way to save and restore files and directories to S3. The
 * container should be configured with the proper AWS credentials and S3 bucket
 * name, and attached to any volumes it should have access to.
 */

/**
 * Log incoming requests
 */
app.use(function(req, res, next) {
	var date = new Date();
	console.log("Got " + req.method + " request to " + req.originalUrl + " at " + date.toDateString() + " " + date.toTimeString());
	next();
});

/*
 * POST requests restore data from S3 to the directory or file specified by the
 * URL. Paths ending with a slash ('/') will be treated as a directory,
 * extracted from a tarball, overwriting existing files and leaving
 * non-colliding existing files
 */
app.post('*', function(req, res, next) {
	return restore(req, res, next, false);
});

/*
 * PUT requests restore data from S3 to the directory or file specified by the
 * URL. Paths ending with a slash ('/') will be treated as a directory,
 * extracted from a tarball, deleting the directory first so that permissions
 * match those in s3 and only files existing in s3 will exist locally
 */
app.put('*', function(req, res, next) {
	return restore(req, res, next, true);
});

function restore(req, res, next, idempotent) {
	var sourcePath = path.normalize(req.originalUrl);
	//remove trailing slash, if it exists
	if (sourcePath.substr(-1) === "/") {
		sourcePath = sourcePath.substr(0, sourcePath.length - 1);
	}
	//remove preceding slash to get s3 key
	var key = sourcePath.slice(1);
	var bucket = process.env.S3_BUCKET_NAME;
	var params = {
		Bucket: bucket,
		Key: key
	};
	var file = s3.getObject(params, function(err, data) {
		if (err) {
			console.log("Error:",  err);
			if (err.statusCode === 404) {
				res.status(404);
				res.json({error: err.message});
			} else {
				res.status(500);
				res.json({error: err.message});
			}
		} else {
			console.log(data.Metadata);
			//set Body string as readable stream
			var stream = new Stream();
			var parentDir = path.dirname(sourcePath);
			stream.pipe = function(dest) {
				dest.write(data.Body);
				return dest;
			}
			if (data.Metadata.iscompressed === 'true') {
				stream = stream.pipe(zlib.Unzip());
				console.log('Unzipped ' + sourcePath);
			}
			//if path to extract is a directory, put contents in parent to avoid nesting
			var extractPath = sourcePath;
			if (data.Metadata.isdirectory !== "true") {
				console.log("Overwrite file");
				extractTar();
			} else {
				extractPath = parentDir;
				//for PUT, clear directory first
				if (idempotent) {
					console.log("Replace dir with tar");
					clearDir(sourcePath, extractTar);
				} else {
					console.log("Merge dir with tar");
					extractTar();
				}
			}
			function clearDir(dir, callback) {
				fs.readdir(dir, function(err, list) {
					if (err) {
						res.status(500);
						res.json({error: err.message});
					}
					list.forEach(function(entry) {
						console.log("dir entry:", entry);
					});
					callback();
				});
			}
			function extractTar() {
				stream.pipe(tar.extract(extractPath));
				console.log('Extracted to ' + extractPath);
				res.json({success: true});
			}
		}
	});
}

/**
 * GET request copy data from the directory or file specified by the URL and
 * save it to S3. Directories will be packed as a tarball.
 */
app.get('*', function(req, res, next) {
	//check if file or directory exists on filesystem
	var sourcePath = path.normalize(req.originalUrl);
	//remove trailing slash, if it exists
	if (sourcePath.substr(-1) === "/") {
		sourcePath = sourcePath.substr(0, sourcePath.length - 1);
	}
	var bucket = process.env.S3_BUCKET_NAME;
	var isFile;
	var isDirectory;
	function onBucketCreate(err, data) {
		if (err) {
			if (err.code === "BucketAlreadyOwnedByYou") {
				console.log("Bucket already exists. Continuing.");
			} else {
				console.log("Error:",  err);
				res.status(500);
				res.json({error: err.message});
			}
		} else {
			console.log("Bucket '" + bucket + "' created or already existed");
		}
		//bucket should exist by now. upload (compressed) file or directory
		var metadata = {
			"iscompressed": "true",
			"isdirectory": "true",
		};
		if (process.env.COMPRESS.toLowerCase() !== "true") {
			metadata.iscompressed = "false";
		}
		if (!isDirectory) {
			metadata.isdirectory = "false";
		}
		var params = getParams(bucket, sourcePath, metadata);
		s3Upload(params, res);
	}
	function onStat(err, stats) {
		isFile = stats.isFile();
		isDirectory = stats.isDirectory();
		if (err) {
			if (err.code === "ENOENT") {
				console.log("stat err:", err);
				res.status(404);
				res.json({error: "'" + sourcePath + "' not found"});
			}
		} else if (isFile || isDirectory) {
			//create bucket if not exists
			var params = {
				Bucket: bucket,
				CreateBucketConfiguration: {
					//this doesn't seem to work
					LocationConstraint: process.env.AWS_DEFAULT_REGION
				}

			};
			s3.createBucket({Bucket: bucket}, onBucketCreate);
		} else {
			res.status(400);
			res.json({error: "'" + sourcePath + "' is not a file or directory. Possibly BlockDevice or other non-standard path type"});
		}
	}
	fs.lstat(sourcePath, onStat);
});

function getParams(bucket, sourcePath, metadata) {
	var body;
	var contentType = "application/x-tar";
	var parentDir = path.dirname(sourcePath);
	var basename = path.basename(sourcePath);
	//remove preceding and trailing slashes for s3 key
	var key = sourcePath.slice(1);
	var params = {};

	if (metadata.isdirectory === "true") {
		body = tar.pack(sourcePath);
	} else {
		body = tar.pack(parentDir, {
			entries: [basename]
		});
	}
	if (metadata.iscompressed === "true") {
		body = body.pipe(zlib.Gzip());
		contentType = "application/x-gtar";
	}
	params = {
		Bucket: bucket,
		Key: key,
		Body: body,
		ContentType: contentType,
		Metadata: metadata
	};
	return params;
}

function s3Upload(params, res) {
	console.log("uploading");
	s3.upload(params, function(err, data) {
		console.log("upload error:", err);
		console.log("upload data:", data);
	})
		.on('httpUploadProgress', function(e) {
			console.log("Progress:", e);
		})
		.send(function(err, data) {
			if (err) {
				console.log("Error:",  err);
				res.status(500);
				res.json({error: err.message});
			} else {
				console.log("data:", data);
				res.json({success: true, data: data});
			}
		});
}

var server = app.listen(80, function() {
	console.log("S3 persistence server started on port 80");
});
