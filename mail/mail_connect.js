var nodemailer = require('nodemailer');

module.exports = function () {
  var config = require('./mail_config');    // ./는 현재 디렉토리를 나타냅니다
  var transporter = nodemailer.createTransport({
    service: config.service,
    auth: {
      user: config.user,
      pass: config.pass
    }
  });

  var mailOptions = {
    from: config.user,
    to: config.to,
    subject: config.subject,
    text: config.text
  };

  return {
    getConnection: transporter,
    getMailOptions: mailOptions,
    end: function(callback){
      transporter.close();
    }
  }
}();
