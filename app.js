const express = require("express");
const multer = require("multer");

const {
  Upload,
} = require("@aws-sdk/lib-storage");

const {
  S3,
} = require("@aws-sdk/client-s3");

const mysql = require("mysql2");
const databaseConfig = require("./database.config");
const bodyParse = require("body-parser");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const sgMail = require("@sendgrid/mail");
const otpGenerator = require("otp-generator");
const { log } = require("console");
require("dotenv").config();

const app = express();
app.use(bodyParse.json());

const s3 = new S3({
  credentials: {
    accessKeyId: process.env.ACCESS_KEY,
    secretAccessKey: process.env.SECRET_KEY,
  },
  region: process.env.REGION,
});

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const storage = multer.memoryStorage({
  destination: function (req, file, callback) {
    callback(null, "");
  },
});

const OTPs = [];

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

function generateAccessToken(user) {
  return jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "7d" });
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (token == null)
    return res.status(401).send({ error: "No authorization token found!" });

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
    if (err) return res.status(403).send({ error: "Unauthorized!" });
    req.user = user;
    next();
  });
}

app.get("/", (req, res) => {
  res.send("<h1>Hello world!</h1>");
});

app.post("/upload", upload, async (req, res) => {
  console.log("starting upload of " + req.file.originalname);
  const params = {
    Bucket: process.env.BUCKET,
    Key: req.file.originalname,
    Body: req.file.buffer,
  };

  try {
    await new Upload({
      client: s3,
      params,
    }).done();

    console.log("upload of " + req.file.originalname + " complete");

    //insert submission data(uid, fieldname) into database with current timestamp
    const connection = createMySQLConnection();
    connection.connect((err) => {
      if (err) {
        console.log(err);
        return res.status(500).send({ error: err });
      }

      const query =
        "INSERT INTO submissions (`user_id`, `fieldname`, `submitted_time`) VALUES (?, ?, ?)";

      connection.query(
        query,
        [req.body.uid, req.body.fieldname, new Date()],
        (err1, result, fields) => {
          if (err1) {
            console.log(err1);
            connection.end();
            return res.status(500).send({ error: err1 });
          }

          connection.end();
          return res.status(200).send({ status: "Success" });
        }
      );
    });
  } catch (error) {
    console.log(error);
    return res.status(500).send(error);
  }
});

app.post("/fields", authenticateToken, (req, res) => {
  const { userID } = req.body;
  const connection = createMySQLConnection();

  connection.connect(function (err) {
    if (err) {
      console.log(err);
      return res.status(500).send({ error: err });
    }

    const query = "SELECT FID, field_name FROM lookup WHERE user_id = ?";

    connection.query(query, [userID], (err1, result, fields) => {
      if (err1) {
        console.log(err1);
        connection.end();
        return res.status(500).send({ error: err });
      }

      if (result.length === 0) {
        connection.end();
        return res.status(404).send({ error: "No Data Found!" });
      } else {
        connection.end();
        return res.status(200).send({ result: result });
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
      return res.status(500).send({ error: err });
    }

    const query =
      "SELECT email, password, user_id FROM lookup WHERE email = ? LIMIT 1";

    connection.query(query, [username], (err1, result, fields) => {
      if (err1) {
        console.log(err1);
        connection.end();
        return res.status(500).send({ error: err });
      }

      if (result.length === 0) {
        connection.end();
        return res.status(403).send({ error: "User not found!" });
      }

      const receivedPassword = crypto
        .createHash("sha256")
        .update(result[0].password)
        .digest("hex");
      if (receivedPassword === password) {
        const user = { id: result[0].user_id };
        const token = generateAccessToken(user);
        connection.end();
        return res.status(200).send({ userID: user.id, accessToken: token });
      } else {
        connection.end();
        return res.status(403).send({ error: "Password is incorrect!" });
      }
    });
  });
});

app.post("/send-otp", (req, res) => {
  const { email } = req.body;
  console.log(email);
  const otp = otpGenerator.generate(6, {
    digits: true,
    lowerCaseAlphabets: false,
    upperCaseAlphabets: false,
    specialChars: false,
  });

  const connection = createMySQLConnection();

  connection.connect((err) => {
    if (err) {
      console.log(err);
      return res.status(500).send({ error: err });
    }

    const query = "SELECT email FROM lookup WHERE email = ? LIMIT 1";

    connection.query(query, [email], (err1, result, fields) => {
      if (err1) {
        console.log(err1);
        connection.end();
        return res.status(500).send({ error: err });
      }

      if (result.length === 0) {
        connection.end();
        return res.status(403).send({ error: "User not found!" });
      }

      sgMail
        .send({
          to: email,
          from: "noreply@em4162.spirocarbon.com",
          subject: "OTP for DigitalCrop",
          templateId: "d-1c0cbb9c2f1f44ddaf354a24f8a41dce",
          dynamicTemplateData: {
            otp: otp,
          },
        })
        .then(
          () => {
            OTPs.push({
              otp: otp,
              user: email,
              createdTime: new Date(Date.now()),
              isUsed: false,
            });
            return res.status(200).send({ status: "success" });
          },
          (error) => {
            if (error.response) {
              console.log(error.response.body);
            }
            return res
              .status(424)
              .send({ status: "failed", error: "Email sending error!" });
          }
        );
    });
  });
});

app.post("/verify-otp", (req, res) => {
  const { otp, email } = req.body;

  if (
    OTPs.find((e) => e.otp === otp && e.user === email && e.isUsed === false)
  ) {
    const storedOTP = OTPs.find(
      (e) => e.otp === otp && e.user === email && e.isUsed === false
    );
    const elapsedTimeInSeconds = Math.floor(
      Math.abs((storedOTP.createdTime.getTime() - new Date().getTime()) / 1000)
    );
    if (elapsedTimeInSeconds <= 300) {
      return res.status(200).send({ verify: true });
    }
    return res.status(200).send({ verify: false });
  } else {
    return res.status(200).send({ verify: false });
  }
});

app.post("/change-password", (req, res) => {
  const { email, password } = req.body;

  const connection = createMySQLConnection();

  connection.connect((err) => {
    if (err) {
      console.log(err);
      return res.status(500).send({ error: err });
    }

    const query = "UPDATE lookup SET password = ? WHERE email = ?";

    connection.query(query, [password, email], (err1, result, fields) => {
      if (err1) {
        console.log(err1);
        connection.end();
        return res.status(500).send({ error: err });
      }

      connection.end();
      return res.status(200).send({ status: "success" });
    });
  });
});

app.post("/add-activity", (req, res) => {
  const { userID, activity, date, fieldName } = req.body;
  const connection = createMySQLConnection();

  connection.connect((err) => {
    if (err) {
      console.log(err);
      return res.status(500).send({ error: err });
    }

    const query = "INSERT INTO farm_activity (`user_ID`, `field_name`, `activity`, `date`) VALUES (?, ?, ?, ?)";


    connection.query(
      query,
      [userID, fieldName, activity, date],
      (err1, result, fields) => {
        if (err1) {
          console.log(err1);
          connection.end();
          return res.status(500).send({ error: err1 });
        }

        connection.end();
        return res.status(200).send({ status: "Success" });
      }
    );
  });
});

app.post("/activities", (req, res) => {
  const { userID } = req.body;

  const connection = createMySQLConnection();

  connection.connect(function (err) {
    if (err) {
      console.log(err);
      return res.status(500).send({ error: err });
    }

    const query = "SELECT * FROM farm_activity WHERE user_id = ?";

    connection.query(query, [userID], (err1, result, fields) => {
      if (err1) {
        console.log(err1);
        connection.end();
        return res.status(500).send({ error: err });
      }
      connection.end();
      return res.status(200).send({ result: result });
    });
  });
});

app.get("/validateToken", authenticateToken, (req, res) => {
  res.status(200).send({ status: "success" });
});

// create a get request to check from the submissions table where same user have submitted a same field within last 24 hours
app.post("/check-submission", (req, res) => {
  const { userID, fieldName } = req.body;
  const connection = createMySQLConnection();

  connection.connect(function (err) {
    if (err) {
      console.log(err);
      return res.status(500).send({ error: err });
    }

    const query =
      "SELECT * FROM submissions WHERE user_id = ? AND fieldname = ? AND submitted_time >= NOW() - INTERVAL 1 DAY";

    connection.query(query, [userID, fieldName], (err1, result, fields) => {
      if (err1) {
        console.log(err1);
        connection.end();
        return res.status(500).send({ error: err });
      }

      if (result.length === 0) {
        connection.end();
        return res.status(200).send({ submitted: false });
      } else {
        connection.end();
        return res.status(200).send({ submitted: true });
      }
    });
  });
});

app.listen(3000, () => {
  console.log("Server started!");
});
