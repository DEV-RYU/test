const http = require("http");
const io = require('socket.io-client');
const request = require('request');
const progress = require('request-progress');
const fs = require('fs');                 // 파일 입출력
const sql = require('./db/db_sql')();     // DB
const systemInfo = require('./properties/system');  // system 정보
const osutils = require("os-utils");      // cpu, memory
const dateFormat = require("dateformat"); // 날짜 형식 변환
const cluster = require('cluster');       // multiThread 사용
const os = require('os');                 // CPU core 개수
const hashmap = require('hashmap');       // 해쉬맵 변수 사용
const nodemailer = require('nodemailer'); // mail 전송
const mail = require('./mail/mail_sql')();
const empty = require('is-empty');

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
var bTpMgProcess = true;  // 프로세스 동작 여부 [true: 진행중, false: 중지]
var bIsRunning = false;   // 동작 중 확인 변수 [true:동작중, false:중지]
var bFinish = true;       // 종료 감지[true:미완료, false:완료]
var worker = null;        // worker 변수
var workerMap = new hashmap();
var socket = null;

console.log("--------------------- argv ----------------------");
agentId = process.argv[2];
console.log("agentId :: " + agentId);
console.log("-------------------------------------------------");

(async function init(){

  if (cluster.isMaster) {

    // addListener 메소드
    process.on('uncaughtException', (err) => {
      console.error('예기치 못한 에러 ::: ', err);
      console.error('예기치 못한 에러 ::: ', err.message);
    });

    //var socket = io.connect('http://192.168.0.158:3000');
    socket = io.connect("http://" + systemInfo.url + ":" + systemInfo.socketPort);

    var cpuCnt = os.cpus().length;  // CPU 개수

    try{
      await fnGetAgentInfo();   // Agent정보 조회
      await fnGetUserInfo();    // 계정정보 조회
      await fnCheckFinishCnt(); // 완료한 파일 카운트 조회하여 동기화

      for(var i=0; i<cpuCnt; i++){
        worker = cluster.fork();    // worker 생성

        // 생성한 워커가 보내는 메시지 처리
        worker.on('message', function (message) {
          if("count" == message.type){
            var wProcessPid = message.processPid;  // worker의 pid
            var wCnt = message.cnt;                // 처리한 개수 [1로 넘어옴]

            if(workerMap.has(wProcessPid)){
              workerMap.set(wProcessPid, workerMap.get(wProcessPid) + wCnt);
            } else{
              workerMap.set(wProcessPid, wCnt);
            }
            console.log(message.processPid + "  :  " + workerMap.get(message.processPid));
            cnt += wCnt;

            fnUpdateTrancnt(cnt);   // DB에 카운트 update
            fnCntSend();            // 카운트 Socket에 전송

          } else if("error" == message.type){
            console.log(JSON.stringify(message));
            fnInsErr(message.agentId, message.agentNm, message.docid, message.errTitle, message.errMsg);
          } else if("finish" == message.type){
            bFinish = message.bFinish;

            for (var id in cluster.workers) {
              // 워커의 pid 비교
              if(message.pid == cluster.workers[id].process.pid){
                cluster.workers[id].kill();     // 워커 종료
              }
            }

            if(empty(cluster.workers)){
              var mailParam = {
                agentId: agentId,
                agentNm: agentNm
              }
              //mail.sendMail();
              mail.sendEndMail(mailParam);
            }
          }
        });
      }
    } catch(err){
      fnInsErr(agentId, '', '', '', err.message);
    }

    // worker 생성 시 event
    cluster.on('online', function (worker) {
      console.log('생성된 워커의 아이디 : ' + worker.process.pid);
    });

    // worker가 죽었을 때 event
    cluster.on('exit', function (worker, code, signal) {
      console.log('죽은 워커의 아이디 : ' + worker.process.pid);
      console.log('죽은 워커의 exit code : ' + code);
      console.log('죽은 워커의 signal : ' + signal);

      if(bFinish){
        worker = cluster.fork();    // worker 생성
      }
    });

    // 소켓 연결 시
    socket.on('connect', function () {
      console.log("connection Id : " + socket.io.engine.id);

      socket.on('toagent-mode', function(data) {
        console.log("received message : " + data);

        if("stop" == data){
          // 중지 이벤트
          bTpMgProcess = false;   // 프로세스 중지 설정 [재귀호출을 막아줌]
          for (var id in cluster.workers) {
            //생성한 워커에게 중지 요청
            cluster.workers[id].send({bTpMgProcess: bTpMgProcess});
          }
        } else if("start" == data){
          // 시작 이벤트
          bTpMgProcess = true;    // 프로세스 진행 설정
          for (var id in cluster.workers) {
            //생성한 워커에게 시작 요청
            cluster.workers[id].send({bTpMgProcess: bTpMgProcess});
          }
        }
      });

      socket.on('disconnect', function(data){
      	console.log("socket disconnect!");
        socket.removeListener('toagent-mode');
      });

    });

    fnGetOsUtil(); // Cpu, Memory 사용량 조회
  } else{
    //마스터가 보낸 메시지 처리
    process.on('message', function(message) {
      console.log('워커가 마스터에게 받은 메시지 : ' + message);

      bTpMgProcess = message.bTpMgProcess;
      if(!bIsRunning && "true" == bTpMgProcess){
        fnMgProcess();
      }
    });
    fnStartMg(); // 마이그레이션 start

    //mail.sendMail();    // 메일 전송
  }
})();

async function fnStartMg(){
  // 노드 시작 시 변수 (args)
  console.log("--------------------- argv ----------------------");
  agentId = process.argv[2];
  console.log("agentId :: " + agentId);
  console.log("-------------------------------------------------");

  try{
    await fnGetAgentInfo();   // Agent정보 조회
    await fnGetUserInfo();    // 계정정보 조회
    fnMgProcess();            // 마이그레이션 프로세스
  } catch(err){
    //process.send({type: "error", agentId: agentId, agentNm: '', docid: '', errTitle: 'Agent정보조회 Error', errMsg: err.message});
    console.log("fnStartMg catch!!!!!!!!!!");
    process.send({type: "error", agentId: agentId, agentNm: agentNm, docid: fileId, errTitle: '', errMsg: err.message});
  }
};

// Agent정보 조회 함수
function fnGetAgentInfo(){
  return new Promise((resolve, reject) => {
    var param = [agentId];

    sql.getAgentInfo(param, function(err, data){
      if (err){
        console.log("getAgentInfoError :: " + err);
        reject(err);
      } else{
        if(0 < data.length){
          agentNm = data[data.length-1].agentname;
          resolve();
        } else{
          reject({message: "Agent정보가 없습니다."});
        }
      }
    });
  });
}

// 계정정보 조회 함수
function fnGetUserInfo(){
  return new Promise((resolve, reject) => {
    console.log("start fnGetUserInfo");

    sql.getUserInfo(function(err, data){
      if (err){
        console.log("getUserInfoError ::: " + err);
        //process.send({type: "error", agentId: agentId, agentNm: agentNm, docid: '', errTitle: '계정정보 조회 Error', errMsg: err.message});
        //throw new Error(err);
        reject(err);
      } else{
        var length = data.length;
        for(var i=0; i<length; i++){
          if('Y' == data[i].varifyyn && 'S' == data[i].type){
            // 인증된 Source Info
            sCecUrl = data[i].baseurl;    // Source URL
            sCecId = data[i].USER;        // Source ID
            sCecPw = data[i].pwd;         // Source Password
          } else if('Y' == data[i].varifyyn && 'T' == data[i].type){
            // 인증된 Target Info
            tCecUrl = data[i].baseurl;    // Target URL
            tCecId = data[i].USER;        // Target ID
            tCecPw = data[i].pwd;         // Target Password
          }
        }

        // validation Check
        if("" == sCecUrl || "" == sCecId || "" == sCecPw){
          reject({message: '("Source Info is Empty : [ sCecUrl = "' + sCecUrl + '", sCecId = "' + sCecId + '", sCecPw = "' + sCecPw + ')'});
        } else if("" == tCecUrl || "" == tCecId || "" == tCecPw){
          reject({message: '("Target Info is Empty : [ tCecUrl = "' + tCecUrl + '", tCecId = "' + tCecId + '", tCecUrl = "' + tCecUrl + ')'});
        } else{
          resolve();
        }
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

    var param = [agentId, 3, agentId];
    sql.getFinishCnt(param, function(err, data){
      if (err){
        // error함수
        // ./error함수
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
    bIsRunning = true;

    try{
      await fnGetFileInfo();        //  Rest요청 - 파일ID를 가져옴
      await fnUpdateStatus('1', agentId, fileId);   // 상태 업데이트 [status --> Start]
      await fnFileDownload();       // AS-IS Cloud 파일 다운로드
      await fnFileUpload();         // Target Cloud 파일 업로드
//      await fnUpdateTrancnt(cnt);   // DB에 카운트 update
//      fnCntSend();                  // 카운트 Socket에 전송
      if(bTpMgProcess){
        fnMgProcess();
      } else{
        bIsRunning = false;
      }
      console.log("ing fnMgProcess" );
    } catch(err){
      //fnInsErr(agentId, agentNm, fileId, err.title, err.message);
      console.log("mgProcessError :: " + err);
      //process.send({type: "error", agentId: agentId, agentNm: agentNm, docid: fileId, errTitle: err.title, errMsg: err.message});
    }
    console.log("end fnMgProcess" );
}

// 파일 정보 가져오는 함수 [Master에 요청]
function fnGetFileInfo(){
  return new Promise((resolve, reject) => {
    //request("http://192.168.0.34:8080/mit/nextDoc", function (error, response, body) {
    request("http://"+ systemInfo.url + ":" + systemInfo.masterPort + "/nextDoc", function (error, response, body) {
      console.log('error:', error); // Print the error if one occurred
      console.log('statusCode:', response && response.statusCode); // Print the response status code if a response was received
      console.log('body:', body); // Print the HTML for the Google homepage.

      if(200 == (response && response.statusCode)){
        var jsonBody = JSON.parse(body);
        fileId = jsonBody.fileId;
        fileNm = jsonBody.fileName;
        tFolderId = jsonBody.tFolderId;

        //fileId = "FINISH";
        if("FINISH" == fileId){
          process.send({type:"finish", pid:process.pid, bFinish: false});
        } else{
          resolve();
        }
      } else{
        reject(error);
      }
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
          console.log("updateStatus!!!!!!!!!");
          reject(err);
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
    console.log("download basciAuth :: " + basicAuth);
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
      console.log("fileDownload!!!!!!!!!");
      reject(err);
    }).on('end', function () {
    }).pipe(fs.createWriteStream(systemInfo.downloadPath + fileNm).on('finish', async function(){
      await fnUpdateStatus('2', agentId, fileId);  // 상태 업데이트 [status --> FileDownload]
      resolve();
    }));
  });
  console.log("end fnFileDownload");
}

// 파일 업로드 함수
function fnFileUpload(){
  console.log("start fnFileUpload");
  return new Promise((resolve, reject) => {
    var basicAuth = "Basic " + Buffer.from(tCecId+":"+tCecPw).toString('base64');   // 인증 token
    console.log("upload basciAuth :: " + basicAuth);
    var url = tCecUrl + "/documents/api/1.2/files/data";             // upload URL
    var jsonInputParameters = {
      "parentID" : tFolderId
    }

    try{
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
            primaryFile: fs.createReadStream(systemInfo.downloadPath + fileNm)
          },
        }, async function (error, response, body) {

          // statusCode로 에러체크

          if("400" == (response && response.statusCode)){
            var jsonBody = JSON.parse(response.body);
            console.log(jsonBody);

            var err400 = {
              title: jsonBody.errorKey,
              message: jsonBody.errorMessage
            }
            reject(err400);

          } else if("200" != (response && response.statusCode) && "201" != (response && response.statusCode)){
            console.log("fileUpload!!!!!!!!!");
            console.log(response.statusCode);
            //error.set("title", "fileUpload Error");
            console.log(error);
            reject(error);
          } else{
            console.log(response.body);
            var jsonBody = JSON.parse(response.body);
            var param = [jsonBody.id, jsonBody.parentID, fileId];

            await fnUpdateTargetFileInfo(param);         // 파일 정보 Update [TargetFileID, TargetParentFolderID, 시간]
            await fnUpdateStatus('3', agentId, fileId);  // 상태 업데이트 [status --> Finish]
            await fnFileRemove();                        // 파일 삭제
            await fnUpdateStatusFileRm(delyn);           // 삭제여부 update
            resolve();
          }
        });
      } catch(e){
        reject(e);
      }
  });
  console.log("end fnFileUpload");
}

function fnUpdateTargetFileInfo(param){
  return new Promise((resolve, reject) => {
    sql.updateTargetFileInfo(param, function(err, data){
      if (err){
        console.log("uploadError ::: " + err);
        reject(err);
      } else {
        //cnt++;
        process.send({type: "count", processPid: process.pid, cnt: 1});
        resolve();
      }
    });
  });
}

// 파일 삭제 함수
function fnFileRemove(){
  return new Promise((resolve, reject) => {
    fs.unlink(systemInfo.downloadPath + fileNm, function(err){
        if( err ) {
          console.log(err.errortitle);
          console.log(err.message);

          //fnInsErr(agentId, agentNm, fileId, "파일 삭제 에러", err.message);
          delyn = 'N';    // 파일 삭제 성공 시 Y, 실패 시 N
          console.log("fileRemove!!!!!!!!!");
          reject(err);
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
        reject(err);
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
       fnInsErr(agentId, agentNm, '', "CPU,Memory ERR" , err.message);
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

  errTitle = errMsg;

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
