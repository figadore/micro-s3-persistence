This image is for persisting data from Docker volumes. Use it to backup local or volume data, migrate a volume to another Docker host or AWS region, or to populate a directory with backed up data when a container starts up. (Hint: If using for backups, try S3's versioning and lifecycle settings for the bucket.) It is meant to be dead-simple, and able to be dropped in anywhere with minimal configuration.

1. Configure S3 through environment variables
2. Start the container with --volumes-from another container
3. Expose port 80 on the host as desired port, or create and link a third container (i.e. a container responsible for managing s3 persistence)
4. Send GET and PUT/POST requests to save and restore files or directories

By separating the concerns in this way, this persistence container is only responsible for saving and restoring data between its volumes and S3. Another container can be responsible for backups, easily cron-able, or for initial container configuration.

Files and directories are stored as tarballs in S3, which allows their permissions to be restored

##Quickstart
Configure and run a container with this image
```bash
docker run -d --env-file s3-env.txt --volumes-from web --name persist shinymayhem/micro-s3-persistence
```
where s3-env.txt contains
```
S3_BUCKET_NAME=web-persistence.example.com
AWS_ACCESS_KEY_ID=mykeyid
AWS_SECRET_ACCESS_KEY=mykey
AWS_DEFAULT_REGION=us-east-2
COMPRESS=true
```
then connect to it with any HTTP client in another container. For example

```
docker run --rm --link persist radial/busyboxplus:curl curl http://persist/var/www
```
backs up the volume /var/www, and 

```
docker run --rm --link persist radial/busyboxplus:curl curl http://persist/var/www -X POST
```
restores /var/www from S3, merging with local files. Finally

```
docker run --rm --link persist radial/busyboxplus:curl curl http://persist/var/www -X PUT
```
restores /var/www from S3, removing local files first

##Usage
Replace \<persistence-host> with the name of the linked persistence service. For example, if you create a container with this image and name it `s3-persister`, and then `backup-container` with a link to `s3-persister:persistence`, your backup container would send requests to http://persistence.


###Files
`GET <persistence-host>/var/www/index.js` will save the file located at `/var/www/index.js` to S3

`PUT <persistence-host>/var/www/index.js` will download and save the file `/var/www/index.js` from S3

`POST <persistence-host>/var/www/index.js` for files, this is functionally the same as PUT

###Directories (trailing slash in url is optional)
`GET <persistence-host>/var/www` will save the contents of the directory `/var/www/` to S3

`PUT <persistence-host>/var/www` will download the directory from S3 and place its contents in `/var/www/` after deleting the target directory first. This clears any files not in the S3 object. (e.g. if /var/www/.gitignore exists locally but not in S3, it will not exist after the PUT)

`POST <persistence-host>/var/www` will download directory from S3 and place its contents in `/var/www/`. This will merge local files with those from the S3 object. (e.g. if /var/www/.gitignore exists locally but not in S3, it will still exist after the POST)


##Configuration
###`S3_BUCKET_NAME`
Name of bucket in your S3 account on AWS. Will be created if it does not exist. Bucket names must be universally unique, so namespacing it with your domain is recommended. E.g. node-persistence.example.com

###`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`
Credentials for S3 access. Note: For additional security, these should be a special set of credentials, created with S3 access only. Using AWS IAM Roles is untested.

###`AWS_DEFAULT_REGION`
AWS Region for bucket location. (Not sure this actually does anything)

###`COMPRESS`
Whether to compress files and directories with gzip. The trade-off is between S3 storage space used (cost) and processing time (performance).

##Example .yml
```yml
s3-persister:
    image: shinymayhem/micro-s3-persistence
    environment:
        S3_BUCKET_NAME: web-persistence.example.com
        AWS_ACCESS_KEY_ID: mykeyid
        AWS_SECRET_ACCESS_KEY: mykey
        #not sure `region` works
        AWS_DEFAULT_REGION: us-east-2
        COMPRESS: true
    volumes_from:
        - web
web:
    image: shinymayhem/node
    volumes:
        - /var/www:/var/www
    ports:
        - "80:80"
backup-host:
    #in this example, the image would periodically send an http request which would backup data in the volume
    image:some/cronjob/image
    links:
        - s3-persister:persistence
    #backup on container startup
    command: curl http://persistence/var/www
    #restore on container startup
    #command: curl http://persistence/var/www -X PUT
```
