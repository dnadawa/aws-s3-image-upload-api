const express = require("express");
const multer = require("multer");
const AWS = require("aws-sdk");
const mysql = require("mysql2");
const databaseConfig = require("./database.config");
const bodyParse = require("body-parser");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
app.use(bodyParse.json());

const s3 = new AWS.S3({
  accessKeyId: process.env.ACCESS_KEY,
  secretAccessKey: process.env.SECRET_KEY,
});

const storage = multer.memoryStorage({
  destination: function (req, file, callback) {
    callback(null, "");
  },
});

const upload = multer({ storage }).single("image");

function createMySQLConnection() {
  return mysql.createConnection({
    host: databaseConfig.host,
    user: databaseConfig.user,
    password: databaseConfig.password,
    database: databaseConfig.database,
    connectTimeout: 30000,
  });
}

app.get("/", (req, res) => {
  res.send("<h1>Hello world!</h1>");
});

app.post("/upload", upload, (req, res) => {
  console.log("starting upload of " + req.file.originalname);
  const params = {
    Bucket: process.env.BUCKET,
    Key: req.file.originalname,
    Body: req.file.buffer,
  };

  s3.upload(params, (err, data) => {
    if (err) {
      res.status(500).send(err);
    }

    res.status(200).send({
      status: "Success",
    });
  });
});

app.post("/fields", (req, res) => {
  const { userID } = req.body;
  const connection = createMySQLConnection();

  connection.connect(function (err) {
    if (err) {
      console.log(err);
      res.status(500).send({ error: err });
    }

    const query = "SELECT FID FROM lookup WHERE user_id = ?";

    connection.query(query, [userID], (err1, result, fields) => {
      if (err1) {
        console.log(err1);
        connection.end();
        res.status(500).send({ error: err });
      }

      if (result.length === 0) {
        connection.end();
        res.status(404).send({ error: "No Data Found!" });
      } else {
        connection.end();
        res.status(200).send({ result: result });
      }

    });
  });
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  const connection = createMySQLConnection();

  connection.connect((err) => {
    if (err) {
      console.log(err);
      res.status(500).send({ error: err });
    }

    const query = "SELECT email, password, user_id FROM lookup WHERE email = ? LIMIT 1";

    connection.query(query, [username], (err1, result, fields) => {
      if (err1) {
        console.log(err1);
        connection.end();
        res.status(500).send({ error: err });
      }

      if (result.length === 0) {
        connection.end();
        res.status(403).send({ error: "User not found!" });
      }

      const receivedPassword = crypto
        .createHash("sha256")
        .update(result[0].password)
        .digest("hex");
      if (receivedPassword === password) {
        connection.end();
        res.status(200).send({ status: "success", user_id : result[0].user_id });
      } else {
        connection.end();
        res.status(403).send({ error: "Password is incorrect!" });
      }
    });
  });
});

app.listen(3000, () => {
  console.log("Server started!");
});
