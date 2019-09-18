const http = require("http");
const io = require('socket.io-client');
const request = require('request');
const progress = require('request-progress');
const fs = require('fs');                 // 파일 입출력
const sql = require('./db/db_sql')();     // DB
const osutils = require("os-utils");      // cpu, memory
const dateFormat = require("dateFormat"); // 날짜 형식 변환

//var socket = io.connect('http://192.168.0.158:3000');
var socket = io.connect('http://localhost:8888');

var agentId = "";         // AgentID
var agentNm = "";         // Agent명
var sCecUrl = "";         // Source BaseUrl
var sCecId = "";          // Source Cloud ID
var sCecPw = "";          // Source Cloud Password
var tCecUrl = "";         // Target BaseUrl
var tCecId = "";          // Target Cloud ID
var tCecPw = "";          // Target Cloud Password
var cnt = 0;              // 완료 건수
var delyn = "N";          // 파일 삭제 플래그 [Y: 삭제완료, N: 미삭제]
var fileId = "";          // 파일ID
var filePath = "";        // 파일명
var tFolderId = "";       // Target Folder ID
var statusParam = [];     // 상태 파라미터 변수
var interval = null;      // setInterval 변수 테스트
var timeout = 10000;      // interval time 변수
var bTpMgProcess = true;  // 프로세스 동작 여부 [true: 진행중, false: 중지]

// 소켓 연결 시
socket.on('connect', function () {
  console.log("connection Id : " + socket.io.engine.id);

  socket.on('toagent-mode', function(data) {
    console.log("received message : " + data);

    if("stop" == data){
      // 중지 이벤트
      bTpMgProcess = false;   // 프로세스 중지 설정 [재귀호출을 막아줌]
    } else if("start" == data){
      // 시작 이벤트
      bTpMgProcess = true;    // 프로세스 진행 설정
      fnMgProcess();          // 마이그레이션 프로세스
    }
  });
});

(async function init(){
  // 노드 시작 시 변수 (args)
  console.log("--------------------- argv ----------------------");
  agentId = process.argv[2];
  console.log("agentId :: " + agentId);
  console.log("-------------------------------------------------");

  await fnGetAgentInfo();   // Agent정보 조회
  await fnGetUserInfo();    // 계정정보 조회
  await fnCheckFinishCnt(); // 완료한 파일 카운트 조회하여 동기화
  fnMgProcess();            // 마이그레이션 프로세스
  fnGetOsUtil();            // Cpu, Memory 사용량 조회
})();
//init();

// Agent정보 조회 함수
function fnGetAgentInfo(){
  return new Promise((resolve, reject) => {
    var param = [agentId];

    sql.getAgentInfo(param, function(err, data){
      if (err){
        fnInsErr(agentId, '', '', 'errTitle', errMsg);
        throw new Error(err);
      } else{
        if(0 < data.length){
          agentNm = data[data.length-1].agentname;
        }
      }
      resolve();
    });
  });
}

// 계정정보 조회 함수
function fnGetUserInfo(){
  return new Promise((resolve, reject) => {
    console.log("start fnGetUserInfo");

    sql.getUserInfo(function(err, data){
      if (err){
        throw new Error(err);
      } else{
        var length = data.length;
        for(var i=0; i<length; i++){
          if('Y' == data[i].varifyYN && 'S' == data[i].type){
            // 인증된 Source Info
            sCecUrl = data[i].baseurl;    // Source URL
            sCecId = data[i].USER;        // Source ID
            sCecPw = data[i].pwd;         // Source Password
          } else if('Y' == data[i].varifyYN && 'T' == data[i].type){
            // 인증된 Target Info
            tCecUrl = data[i].baseurl;    // Target URL
            tCecId = data[i].USER;        // Target ID
            tCecPw = data[i].pwd;         // Target Password
          }
        }

        // validation Check
        if("" == sCecUrl || "" == sCecId || "" == sCecPw){
          reject(new Error("Source Info is Empty : [ sCecUrl = " + sCecUrl + ", sCecId = " + sCecId + ", sCecPw = " + sCecPw));
        } else if("" == tCecUrl || "" == tCecId || "" == tCecPw){
          reject(new Error("Target Info is Empty : [ tCecUrl = " + tCecUrl + ", tCecId = " + tCecId + ", tCecUrl = " + tCecUrl));
        }
        resolve();
      }
      console.log("ing fnGetUserInfo");
    });
    console.log("end fnGetUserInfo");
  });
}

// 완료한 파일 카운트 조회하여 동기화
function fnCheckFinishCnt(){
  return new Promise((resolve, reject) => {
    console.log("start fnCheckFinishCnt");

    var param = [agentId, 2, agentId];
    sql.getFinishCnt(param, function(err, data){
      if (err){
        throw new Error(err);
      } else{
        var docCnt = 0;
        var trancnt = 0;
        var length = data.length;

        for(var i=0; i<length; i++){
          docCnt = docCnt > data[i].docCnt ? docCnt : data[i].docCnt;
          trancnt = trancnt > data[i].trancnt ? trancnt : data[i].trancnt;
        }

        if(docCnt != trancnt){
          fnUpdateTrancnt(docCnt);    // agent의 trancnt를 Update
        }

        cnt = docCnt;       // 카운트 초기화 [DB를 조회하여 Cnt로 초기화]
        fnCntSend();        // 카운트 전송
        resolve();
      }
      console.log("ing fnCheckFinishCnt");
    });
    console.log("end fnCheckFinishCnt");
  });
}

// agent의 trancnt를 Update
function fnUpdateTrancnt(docCnt){
  console.log(docCnt);

  var param = [docCnt, agentId];
  sql.updateTrancnt(param, function(err, data){
    if (err){
      reject(new Error(err));
    } else{
      //console.log(data);
    }
  });
}

// 마이그레이션 메인 프로세스 함수
async function fnMgProcess(){
    console.log("start fnMgProcess" );

    try{
      await fnGetFileInfo();        //  Rest요청 - 파일ID를 가져옴
      await fnUpdateStatus('1', agentId, fileId);   // 상태 업데이트 [status --> Start]
      await fnFileDownload();       // AS-IS Cloud 파일 다운로드
      await fnFileUpload();         // Target Cloud 파일 업로드
      await fnUpdateStatus('2', agentId, fileId);  // 상태 업데이트 [status --> Finish]
      await fnFileRemove();         // 파일 삭제
      await fnUpdateStatusFileRm(delyn);
      await fnUpdateTrancnt(cnt);   // DB에 카운트 update
      fnCntSend();                  // 카운트 Socket에 전송
      if(bTpMgProcess){
        fnMgProcess();
      }
      console.log("ing fnMgProcess" );
    } catch(err){
      fnInsErr(agentId, agentNm, fileId, err.title, err.message);
    }
    console.log("end fnMgProcess" );
}

// 파일 정보 가져오는 함수 [Master에 요청]
function fnGetFileInfo(){
  return new Promise((resolve, reject) => {
    //request("http://192.168.0.34:8080/mit/nextDoc", function (error, response, body) {
    request("http://localhost:8080/mit/nextDoc", function (error, response, body) {
      console.log('error:', error); // Print the error if one occurred
      console.log('statusCode:', response && response.statusCode); // Print the response status code if a response was received
      console.log('body:', body); // Print the HTML for the Google homepage.

      var jsonBody = JSON.parse(body);
      fileId = jsonBody.fileId;
      fileNm = jsonBody.fileName;
      tFolderId = jsonBody.tFolderId;
      resolve();
    });
  });
}

// 파일 상태 업데이트 함수
function fnUpdateStatus(status, agentId, fileId){
  console.log("start fnUpdateStatus");
  return new Promise((resolve, reject) => {
      // Status
      statusParam = [status, agentId, fileId];
      sql.updateStatus(statusParam, function(err, data){
        if (err){
          reject(new Error(err));
        }
        // else console.log(data);
      });
    resolve();
  });
  console.log("end fnUpdateStatus");
}

// 파일 다운로드 함수
function fnFileDownload(){
  console.log("start fnFileDownload");
  return new Promise((resolve, reject) => {
    var basicAuth = "Basic " + Buffer.from(sCecId+":"+sCecPw).toString('base64');   // 인증 token
    var url = sCecUrl + "/documents/api/1.2/files/" + fileId + "/data";             // download URL
    var start = new Date();

    // oracle download Api 호출
    progress(request({
      method: "GET",
      url: url,
      headers : {
        Authorization: basicAuth
      }
    }), {
        // throttle: 2000,                    // Throttle the progress event to 2000ms, defaults to 1000ms
        // delay: 1000,                       // Only start to emit after 1000ms delay, defaults to 0ms
        // lengthHeader: 'x-transfer-length'  // Length header to use, defaults to content-length
    }).on('progress', function (state) {
        // The state is an object that looks like this:
        // {
        //     percent: 0.5,               // Overall percent (between 0 to 1)
        //     speed: 554732,              // The download speed in bytes/sec
        //     size: {
        //         total: 90044871,        // The total payload size in bytes
        //         transferred: 27610959   // The transferred payload size in bytes
        //     },
        //     time: {
        //         elapsed: 36.235,        // The total elapsed seconds since the start (3 decimals)
        //         remaining: 81.403       // The remaining seconds to finish (3 decimals)
        //     }
        // }
        console.log('progress', state);
    }).on('error', function (err) {
      reject(new Error(err));
    }).on('end', function () {
      resolve();
    }).pipe(fs.createWriteStream('D:/' + fileNm));
  });
  console.log("end fnFileDownload");
}

// 파일 업로드 함수
function fnFileUpload(){
  console.log("start fnFileUpload");
  return new Promise((resolve, reject) => {
    var basicAuth = "Basic " + Buffer.from(tCecId+":"+tCecPw).toString('base64');   // 인증 token
    var url = tCecUrl + "/documents/api/1.2/files/data";             // upload URL
    var jsonInputParameters = {
      "parentID" : tFolderId
    }

    // oracle download Api 호출
    var fileUpload = request.post(
      {
        url: url,
        headers : {
          Authorization: basicAuth,
          contentType: "multipart/form-data"
        },
        formData : {
          /*
           *  순서가 중요!!
           * jsonInputParameters가 primaryFile보다 앞에 입력해줘야함!!
           */
          jsonInputParameters: JSON.stringify(jsonInputParameters),
          primaryFile: fs.createReadStream('D:/' + fileNm)
        },
      }, function (error, response, body) {

        // statusCode로 에러체크

        if("200" != (response && response.statusCode) && "201" != (response && response.statusCode)){
          reject(new Error(error));
        }

        var jsonBody = JSON.parse(response.body);
        var param = [jsonBody.id, jsonBody.parentID, fileId];

        sql.updateTargetFileInfo(param, function(err, data){
          if (err){
            reject(new Error(err));
          } else {
            cnt++;
          }
        });
        resolve();
      });
  });
  console.log("end fnFileUpload");
}

// 파일 삭제 함수
function fnFileRemove(){
  return new Promise((resolve, reject) => {
    fs.unlink('D:/' + fileNm, function(err){
        if( err ) {
          console.log(err.errortitle);
          console.log(err.message);

          //fnInsErr(agentId, agentNm, fileId, "파일 삭제 에러", err.message);
          delyn = 'N';    // 파일 삭제 성공 시 Y, 실패 시 N
          reject(new Error(err));
        } else{
          delyn = 'Y';    // 파일 삭제 성공 시 Y, 실패 시 N
        }
        console.log("fnFileRemove!!!");
        resolve();
    });
  });
}

// 파일 삭제 상태 업데이트 함수
function fnUpdateStatusFileRm(delyn){
  return new Promise((resolve, reject) => {
    // 파일 삭제 Status Update
    statusParam = [delyn, fileId];
    sql.updateStatusFileRm(statusParam, function(err, data){
      if (err){
        reject(new Error(err));
      }
      // else console.log(data);
    });
    resolve();
  });
}

// 카운트 소켓 전송 함수
function fnCntSend(){
  // 소켓 연결 확인
  if(true == socket.connected){
    /*
     * 카운트를 데이터로 보내줌
     * agentId : 에이전트ID, cnt : 완료한 건수
     */
    var data = {
      agentId : agentId,
      cnt : cnt
    }
    socket.emit('proxy-for-bar', data);   // 전송
    console.log("cnt :: " + cnt + ", socket connected :: " + socket.connected);
  }
}

// CPU와 MEMORY 조회 함수
function fnGetOsUtil(){
  setInterval(function () {
    try{
       var used = process.memoryUsage().heapUsed;
       var memUsage = 100 - `${Math.round(osutils.freememPercentage() * 100)}`;
       osutils.cpuUsage(function(v) {
           socket.emit('proxy-for-chart', {'agentId' : agentId, 'cpuUsage' : (v*100).toFixed(2), 'memUsage' : memUsage});
       });
     } catch(err){
       fnInsErr(agentId, agentNm, '', "CPU,Memory ERR" , e.message);
       //reject(new Error(err));
     }
   }, 3000);
}

// Error처리
function fnInsErr(agentId, agentNm, docid, errTitle, errMsg){
  var curDate = new Date();
  var time = dateFormat(curDate, 'yyyy-mm-dd HH:MM:ss');
  var errParam = [];
  var strErr = "";

  if('' == docid){
    errParam = [agentId, '', curDate, errTitle, errMsg];
    strErr = agentNm + ' ' + time + ' ' + errTitle + '\n';
  } else{
    errParam = [agentId, docid, curDate, errTitle, errMsg];
    strErr = agentNm + ' ' + docid + ' ' + time + ' ' + errTitle + '\n';
  }

  sql.insertError(errParam, function(err, data){
    if (err){
      console.log(err);
    } else{
      socket.emit('proxy-for-err', {'agentId' : agentId, 'errMsg' : strErr});
    }
  });
}
