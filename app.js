const express = require('express');
const multer = require('multer');
const AWS = require('aws-sdk');
require('dotenv').config()

const app = express();

const s3 = new AWS.S3({
    accessKeyId: process.env.ACCESS_KEY,
    secretAccessKey: process.env.SECRET_KEY
});

const storage = multer.memoryStorage({
    destination: function (req, file, callback) {
        callback(null, '');
    }
});

const upload = multer({storage}).single("image");


app.post('/upload', upload, (req, res) => {
    console.log("starting upload of " + req.file.originalname);
    const params = {
        Bucket: process.env.BUCKET,
        Key: req.file.originalname,
        Body: req.file.buffer
    };

    s3.upload(params,  (err, data) => {
        if(err){
            res.status(500).send(err);
        }

        res.status(200).send({
            'status': "Success"
        });
    });
});


app.listen(443, () => {
    console.log("Server started!");
});