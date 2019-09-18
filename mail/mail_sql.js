var pool = require('./mail_connect');

module.exports = function () {
  return {
    sendMail: function(){
      var transporter = pool.getConnection;
      transporter.sendMail(pool.getMailOptions, function(error, info){
        if (error) {
          console.log(error);
          pool.end();
        } else {
          console.log('Email sent: ' + info.response);
          pool.end();
        };
      });
    },
    sendEndMail: function(param){
      var transporter = pool.getConnection;
      console.log("param ::: " + param);

      var mailOption = {
        from: pool.getMailOptions.user,
        to: pool.getMailOptions.to,
        subject: param.agentNm + "[" + param.agentId + "]Agent가 종료되었습니다.",
        text: param.agentNm + "[" + param.agentId + "]Agent가 종료되었습니다."
      }

      transporter.sendMail(mailOption, function(error, info){
        if (error) {
          console.log(error);
          pool.end();
        } else {
          console.log('Email sent: ' + info.response);
          pool.end();
        };
      });
    }
  };
};
