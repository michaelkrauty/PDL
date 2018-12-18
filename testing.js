const http = require('http');
const mysql = require('mysql');
const config = require('./config.js');
const port = 80;

var con;

con = mysql.createConnection({
    host: config['db']['host'],
    user: config['db']['user'],
    database: config['db']['database'],
    password: config['db']['password'],
});
con.connect(function (err) {
    if (err) throw err;
    console.log('Connected to MySQL DB!');
});
var sql = 'SELECT * FROM users';
con.query(sql, function (err, res) {
    if (err) throw err;
    console.log(res);
    con.end();
});