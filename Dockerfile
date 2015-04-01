FROM shinymayhem/node:onbuild

ENV S3_BUCKET_NAME micro-persistence.example.com
ENV AWS_ACCESS_KEY_ID **DefineMe**
ENV AWS_SECRET_ACCESS_KEY **DefineMe**
ENV AWS_DEFAULT_REGION us-east-1
ENV COMPRESS true

#probably need to be root to restore many directories
USER root
