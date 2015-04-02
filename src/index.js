var express = require('express');
var aws = require('aws-sdk');
var path = require('path');
var fs = require('fs');
var zlib = require('zlib');
var tar = require('tar-fs');
var fse = require('fs-extra');
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
	console.log("===S3-Persister==>Got " + req.method + " request to " + req.originalUrl + " at " + date.toDateString() + " " + date.toTimeString());
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
			console.log("===S3-Persister==>Error in getObject():",  err);
			if (err.statusCode === 404) {
				res.status(404);
				res.json({error: err.message});
			} else {
				res.status(500);
				res.json({error: err.message});
			}
		} else {
			console.log("===S3-Persister==>Wrote ", data.Metadata);
			//set Body string as readable stream
			var stream = new Stream();
			var parentDir = path.dirname(sourcePath);
			stream.pipe = function(dest) {
				dest.write(data.Body);
				return dest;
			}
			if (data.Metadata.iscompressed === 'true') {
				stream = stream.pipe(zlib.Unzip());
				console.log('===S3-Persister==>Unzipped ' + sourcePath);
			}
			var extractPath = sourcePath;
			if (data.Metadata.isdirectory !== "true") {
				//if path to extract is a file, put contents in parent to avoid nesting
				extractPath = parentDir;
				console.log("===S3-Persister==>Overwriting file");
				extractTar();
			} else {
				//for PUT, clear directory first
				if (idempotent) {
					console.log("===S3-Persister==>Replacing dir with tar");
					clearDir(extractPath, extractTar);
				} else {
					console.log("===S3-Persister==>Merging dir with tar");
					extractTar();
				}
			}
			function clearDir(dir, callback) {
				fs.readdir(dir, function(err, list) {
					if (err) {
						res.status(500);
						console.log("===S3-Persister==>Error in clearDir():",  err);
						res.json({error: err.message});
					}
					var toRemove = list.length;
					var fullPath;
					if (toRemove <= 0) {
						callback();
					}
					list.forEach(function(entry) {
						fullPath = dir + "/" + entry;
						fse.remove(fullPath, function(err) {
							if (err) {
								console.log("===S3-Persister==>Error in remove():", err);
							}
							toRemove--;
							if (toRemove <= 0) {
								callback();
							}
						});
					});
				});
			}
			function extractTar() {
				stream.pipe(tar.extract(extractPath));
				console.log('===S3-Persister==>Extracted to ' + extractPath);
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
				console.log("===S3-Persister==>Bucket already exists. Continuing.");
			} else {
				console.log("===S3-Persister==>Error while creating bucket:",  err);
				res.status(500);
				res.json({error: err.message});
			}
		} else {
			console.log("===S3-Persister==>Bucket '" + bucket + "' created or already existed");
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
				console.log("===S3-Persister==>Stat err:", err);
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
			console.log("===S3-Persister==>" + err);
			console.log("===S3-Persister==>'" + sourcePath + "' is not a file or directory. Possibly BlockDevice or other non-standard path type");
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
	console.log("===S3-Persister==>uploading");
	s3.upload(params, function(err, data) {
		console.log("===S3-Persister==>Upload error:", err);
		console.log("===S3-Persister==>Upload data:", data);
	})
		.on('httpUploadProgress', function(e) {
			console.log("===S3-Persister==>Upload Progress:", e);
		})
		.send(function(err, data) {
			if (err) {
				console.log("===S3-Persister==>Error while uploading:",  err);
				res.status(500);
				res.json({error: err.message});
			} else {
				console.log("===S3-Persister==>Upload complete. Data:", data);
				res.json({success: true, data: data});
			}
		});
}

var server = app.listen(80, function() {
	console.log("===S3-Persister==>S3 persistence server started on port 80");
});
