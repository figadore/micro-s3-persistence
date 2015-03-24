This service is for persisting data from Docker volumes. It is meant to be dead-simple, and able to be dropped in anywhere with minimal configuration. Use it to backup local or volume data, migrate a volume to another Docker host or AWS region, or to populate a directory with backed up data when a container starts up.

1. Configure S3 through environment variables
2. Start the container with --volumes-from another container
3. Expose port 80 on the host as desired port, or create and link a third container (i.e. a container responsible for managing s3 persistence)
4. Send GET and PUT/POST requests to save and restore files or directories

By separating the concerns in this way, this persistence container is only responsible for saving and restoring data between its volumes and S3. Another container can be responsible for backups, easily cron-able, or for initial container configuration.

Files and directories are stored as tarballs in S3, which allows them to save their permissions

##Usage
Replace \<persistence-host> with the name of the linked service. For example, if you create a container with this image and name it `s3-persister`, and `backup-container` with a link to `s3-persister:persistence`, your backup container would send requests to http://persistence.

`GET <persistence-host>/var/www/index.js` will save the file located at `/var/www/index.js` to S3, compressed, if the COMPRESS environment variable is set to `'true'`.

`GET <persistence-host>/var/www/` will tar and save the directory `/var/www/` to S3, compressed, if the COMPRESS environment variable is set to `'true'`.

`PUT <persistence-host>/var/www/index.js` will download (and uncompress, if needed) the file `/var/www/index.js` from S3 after first deleting it.

`PUT <persistence-host>/var/www/` will download and untar (and uncompress, if needed) the directory `/var/www/` from S3 after deleting the target directory. This clears any files not in the S3 object. (e.g. if /var/www/.gitignore exists locally but not in S3, it will not exist after the PUT)

`POST <persistence-host>/var/www/index.js` will download (and uncompress, if needed) the file `/var/www/index.js` from S3

`POST <persistence-host>/var/www/` will download and untar (and uncompress, if needed) the directory `/var/www/` from S3. This will merge local files with those from the S3 object. (e.g. if /var/www/.gitignore exists locally but not in S3, it will still exist after the POST)

##Configuration
###`S3_BUCKET_NAME`
Name of bucket in your S3 account on AWS. Will be created if it does not exist. Bucket names must be universally unique, so namespacing it with your domain is recommended. E.g. node-persistence.example.com

###`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`
Credentials for S3 access. Note: For additional security, these should be a special set of credentials, created with S3 access only.

###`AWS_DEFAULT_REGION`
AWS Region for bucket location

###`COMPRESS`
Whether to compress files and directories with gzip. The trade-off is between S3 storage space used (cost) and processing time (performance).

##Example .yml
```yml
s3-persister:
    image: shinymayhem/micro-s3-persist
    environment:
        S3_BUCKET_NAME: web-persistence.example.com
        AWS_ACCESS_KEY_ID: mykeyid
        AWS_SECRET_ACCESS_KEY: mykey
        #not sure that region works
        AWS_DEFAULT_REGION: us-east-2
        COMPRESS: true
    volumes_from:
        - web
web:
    image: node
    volumes:
        - /var/www
    ports:
        - "80:80"
backup-host:
    image:some/cronjob/image
    links:
        - s3-persister:persistence
    #backup on container startup
    command: curl http://persistence/var/www
    #restore on container startup
    #command: curl http://persistence/var/www -X PUT
```

###TODO
* Run node server as non-root?
