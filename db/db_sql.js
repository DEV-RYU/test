var pool = require('./db_connect');

module.exports = function () {
  return {
    getAgentInfo: function(param, callback){
      pool.getConnection(function(err, con){
        var sql = 'SELECT * from tblagents WHERE agentid = ?';
        con.query(sql, param, function (err, result, fields) {
          con.release();
          if (err) return callback(err);
          callback(null, result);
        });
      });
    },
    getUserInfo: function(callback){
      pool.getConnection(function(err, con){
        var sql = 'SELECT * from tblcecinfo';
        con.query(sql, function (err, result, fields) {
          con.release();
          if (err) return callback(err);
          callback(null, result);
        });
      });
    },
    getFinishCnt: function(param, callback){
      pool.getConnection(function(err, con){
        var sql = 'SELECT COUNT(docid) docCnt, 0 trancnt FROM tbldocs WHERE agentid = ? AND status = ? UNION ALL SELECT 0 docCnt, trancnt trancnt FROM tblagents WHERE agentid = ?';
        con.query(sql, param, function (err, result, fields) {
          con.release();
          if (err) return callback(err);
          callback(null, result);
        });
      });
    },
    updateTrancnt: function(param, callback){
      pool.getConnection(function(err, con){
        var sql = 'UPDATE tblagents SET trancnt = ? WHERE AGENTID = ?';
        con.query(sql, param, function (err, result, fields) {
          con.release();
          if (err) return callback(err);
          callback(null, result);
        });
      });
    },
    updateStatus: function(param, callback){
      pool.getConnection(function(err, con){
        var sql = 'UPDATE tbldocs SET status = ?, agentId = ?, stdate = NOW() WHERE docid = ?';
        con.query(sql, param, function (err, result, fields) {
          con.release();
          if (err) return callback(err);
          callback(null, result);
        });
      });
    },
    updateStatusFileRm: function(param, callback){
      pool.getConnection(function(err, con){
        var sql = 'UPDATE tbldocs SET delyn = ? WHERE docid = ?';
        con.query(sql, param, function (err, result, fields) {
          con.release();
          if (err) return callback(err);
          callback(null, result);
        });
      });
    },
    updateTargetFileInfo: function(param, callback){
      pool.getConnection(function(err, con){
        var sql = 'UPDATE tbldocs SET tdocid = ?, tfolderid = ?, eddate = NOW() WHERE docid = ?';
        con.query(sql, param, function (err, result, fields) {
          con.release();
          if (err) return callback(err);
          callback(null, result);
        });
      });
    },
    insertError: function(param, callback){
      pool.getConnection(function(err, con){
        var sql = 'INSERT INTO tblerrorlog (agentId, docid, stdate, errortitle, errordetail) VALUES (?, ?, ?, ?, ?)';
        con.query(sql, param, function (err, result, fields) {
          con.release();
          if (err) return callback(err);
          callback(null, result);
        });
      });
    },
    pool: pool
  }
};
