var express = require('express');
var app = express();
var aws = require('aws-sdk');
var bucket = process.env.S3_BUCKET_NAME;
var s3 = new aws.S3();

var fs = require('fs');
var zlib = require('zlib');
var tar = require('tar-fs');

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
	var key;
	var path = req.originalUrl;
	if (isDir(req)) {
		console.log("restore dir");
		key = path.slice(1,-1);
	} else {
		console.log("restore file");
		key = path.slice(1);
	}
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
			console.log(data);
			res.json({success: true});
		}
	});
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
	var params = {
		Bucket: bucket,
		CreateBucketConfiguration: {
			//this doesn't seem to work
			LocationConstraint: process.env.AWS_DEFAULT_REGION
		}

	};
	s3.createBucket({Bucket: bucket}, function(err, data) {
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
		var path = req.originalUrl;
		var compressed = process.env.COMPRESS.toLowerCase();
		if (compressed !== "true") {
			compressed = "false";
		}
		if (isDir(req)) {
			console.log("store dir");
			storeDirectory(bucket, path, compressed, res);
		} else {
			console.log("store file");
			storeFile(bucket, path, compressed, res);
		}

	});
});


function storeDirectory(bucket, path, compressed, res) {
	var body;
	var contentType = "application/x-tar";
	//remove preceding and trailing slashes for s3 key
	//var key = path.slice(1,-1);
	var key = path.slice(1,-1);
	body = tar.pack(path);

	if (compressed === "true") {
		body = body.pipe(zlib.Gzip());
		contentType = "application/x-gtar";
	}
	var params = {
		Bucket: bucket,
		Key: key,
		Body: body,
		ContentType: contentType,
		Metadata: {
			compressed: compressed,
			directory: "true"
		}
	};
	upload(params, res);
}

function storeFile(bucket, path, compressed, res) {
	var body;
	var contentType = "application/octet-stream";
	//remove preceding slash for s3 storage key
	var key = path.slice(1);
	body = fs.createReadStream(path);
	if (compressed === "true") {
		body = body.pipe(zlib.createGzip());
		contentType = "application/x-gzip";
	}
	var params = {
		Bucket: bucket,
		Key: key,
		Body: body,
		ContentType: contentType,
		Metadata: {
			compressed: compressed,
			directory: "false"
		}
	};
	upload(params, res);
}

function upload(params, res) {
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
