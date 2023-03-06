const express = require('express');
const multer = require('multer');
const AWS = require('aws-sdk');
const mysql = require('mysql2');
const databaseConfig = require("./database.config");
require('dotenv').config();

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

app.get('/', (req, res) => {
    res.send("<h1>Hello world!</h1>");
});

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

app.get('/fields', (req, res) => {
    const connection = mysql.createConnection({
        host: databaseConfig.host,
        user: databaseConfig.user,
        password: databaseConfig.password,
        database: databaseConfig.database,
        insecureAuth: true,
        port: 3306,
        connectTimeout: 30000,
    });

    connection.connect(function(err) {
        if (!err) {
            connection.query('SELECT * FROM lookup', (err1, result, fields) => {
                if(err1){
                    console.log(err1);
                    res.status(400);
                    return;
                }

                res.status(200).send(result);
            });
        } else {
            console.log("mysql connection lost " + err);
        }
    });
});

app.listen(3000, () => {
    console.log("Server started!");
});