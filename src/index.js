var express = require('express');
var app = express();
var aws = require('aws-sdk');
var bucket = process.env.S3_BUCKET_NAME;
var s3 = new aws.S3();

var fs = require('fs');
var zlib = require('zlib');
var tar = require('tar');

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

function isDir(req) {
	var url = req.originalUrl;
	var lastChar = url.slice(-1);
	if (lastChar === "/") {
		return true;
	}
	return false;
}

/*
 * GET requests restore data from S3 to the directory or file specified by the
 * URL. Paths ending with a slash ('/') will be treated as a directory,
 * extracted from a tarball, overwriting existing files.
 */
app.get('*', function(req, res, next) {
	if (isDir(req)) {
		console.log("dir");
	} else {
		console.log("file");
	}
	res.json({success: true});
});

/**
 * PUT request copy data from the directory or file specified by the URL and
 * save it to S3. Directories will be packed as a tarball.
 */
app.put('*', function(req, res, next) {
	//check if file or directory exists on filesystem

	//compress file or directory
	
	//create bucket if not exists
	var bucket = process.env.S3_BUCKET_NAME;
	s3.createBucket({Bucket: bucket}, function(err, data) {
		if (err) {
			if (err.code === "BucketAlreadyOwnedByYou") {
				console.log("Bucket already exists");
			} else {
				console.log("Error:",  err);
				res.status(500);
				res.json({error: err.message});
			}
		} else {
			console.log("Bucket '" + bucket + "' created or already existed");
			console.log("Data:", data);
		}
		//bucket should exist by now. upload (compressed) file or directory
		var path = req.originalUrl;
		if (isDir(req)) {
			console.log("dir");
			storeDirectory(bucket, path, res);
		} else {
			console.log("file");
			storeFile(bucket, path, res);
		}

	});
});


function storeDirectory(bucket, path, res) {
	res.json({success: true});
}

function storeFile(bucket, path, res) {
	var key = path.slice(1);
	var file;
	if (process.env.COMPRESS === "true") {
		console.log("Compress");
		file = fs.createReadStream(path).pipe(zlib.createGzip());
	} else {
		console.log("Uncompressed");
		file = fs.createReadStream(path);
	}
	var params = {
		Bucket: bucket,
		Key: key,
		Body: file
	};
	s3.upload(params)
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
