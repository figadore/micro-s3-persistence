This service is for persisting data from Docker volumes. It is meant to be dead-simple

1. Configure S3 through environment variables
2. Start the container with --volumes-from another container
3. Send PUT and GET requests to save and restore files or directories (send from a third container so that there are no circular dependencies)

By separating the concerns in this way, this persistence container is only responsible for saving and restoring data between its volumes and S3. Another container can be responsible for backups, easily cron-able, or for initial container configuration.

##Usage
Replace \<persistence-host> with the name of the linked service. For example, if you create a container with this image and name it `s3-persister`, and `backup-container` with a link to `s3-persister:persistence`, your backup container would send requests to http://persistence.

`PUT <persistence-host>/var/www/index.js` will save the file located at `/var/www/index.js` to S3, compressed, if the COMPRESS environment variable is set to `'true'`.

`PUT <persistence-host>/var/www/` will tar and save the directory `/var/www/` to S3, compressed, if the COMPRESS environment variable is set to `'true'`.

`GET <persistence-host>/var/www/index.js` will download (and uncompress, if needed) the file `/var/www/index.js` from S3

`GET <persistence-host>/var/www/` will download and untar (and uncompress, if needed) the directory `/var/www/` from S3

##Configuration
Set the environment variables below in an environment file for the `docker run` command, or set them in a .yml file for docker-compose

###`S3_BUCKET_NAME`
Name of bucket in your S3 account on AWS. Will be created if it does not exist. Bucket names must be universally unique, so namespacing it with your domain is recommended. E.g. node-persistence.example.com

###`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`
Credentials for S3 access. Note: For additional security, these should be a special set of credentials, created with S3 access only.

###`AWS_DEFAULT_REGION`
AWS Region for bucket location

###`COMPRESS`
Whether to compress files and directories with gzip. The trade-off is between S3 storage space used (cost) and processing time (performance). Set to `'true'` by default


