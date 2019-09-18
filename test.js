const fs = require('fs');
const request = require('request');

var url = "https://mhme-a430673.documents.us2.oraclecloud.com/documents/api/1.2/files/D49AF1896C271BC5870F0AFE74174AF41EEE86FCFE55/data";
var basicAuth = "Basic " + Buffer.from("thlee@suholdings.com:Suholdings1!").toString('base64');   // 인증 token

request.get(
  {
    url: url,
    headers : {
      Authorization: basicAuth
    }
  }, function (error, response, body) {
    console.log('error:', error); // Print the error if one occurred
    console.log('statusCode:', response && response.statusCode); // Print the response status code if a response was received
  }).pipe(fs.createWriteStream('d:/2017.03.17_GC80CW_Release_Notes_for_User_1.00.25.4075.docx'));
