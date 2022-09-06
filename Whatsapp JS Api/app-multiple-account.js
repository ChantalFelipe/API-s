const { Client, MessageMedia, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const socketIO = require('socket.io');
const qrcode = require('qrcode');
const http = require('http');
const fs = require('fs');
const { phoneNumberFormatter } = require('./helpers/formatter');
const fileUpload = require('express-fileupload');
const axios = require('axios');
const port = process.env.PORT || 8000;

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));

/**
 * BASED ON MANY QUESTIONS
 * Actually ready mentioned on the tutorials
 * 
 * The two middlewares above only handle for data json & urlencode (x-www-form-urlencoded)
 * So, we need to add extra middleware to handle form-data
 * Here we can use express-fileupload
 */
app.use(fileUpload({
  debug: false
}));

app.get('/', (req, res) => {
  res.sendFile('index-multiple-account.html', {
    root: __dirname
  });
});

const sessions = [];
const SESSIONS_FILE = './whatsapp-sessions.json';

const createSessionsFileIfNotExists = function() {
  if (!fs.existsSync(SESSIONS_FILE)) {
    try {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify([]));
      console.log('Sessions file created successfully.');
    } catch(err) {
      console.log('Failed to create sessions file: ', err);
    }
  }
}

const isEmptyObject = function (obj)
{
   return !!Object.values(obj).length;    
}
   

createSessionsFileIfNotExists();

const setSessionsFile = function(sessions) {
  fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions), function(err) {
    if (err) {
      console.log(err);
    }
  });
}

const getSessionsFile = function() {
  return JSON.parse(fs.readFileSync(SESSIONS_FILE));
}

const createSession = function(id, description) {
  console.log('Creating session: ' + id);
  const client = new Client({
    restartOnAuthFail: true,
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process', // <- this one doesn't works in Windows
        '--disable-gpu'
      ],
    },
    authStrategy: new LocalAuth({
      clientId: id
    })
  });

  client.initialize();

  client.on('qr', (qr) => {
    console.log('QR RECEIVED', qr);
    qrcode.toDataURL(qr, (err, url) => {
      io.emit('qr', { id: id, src: url });
      io.emit('message', { id: id, text: 'QR Code received, scan please!' });
    });
  });

  client.on('ready', () => {
    io.emit('ready', { id: id });
    io.emit('message', { id: id, text: 'Whatsapp is ready!' });

    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions[sessionIndex].ready = true;
    setSessionsFile(savedSessions);
  });

  client.on('authenticated', () => {
    io.emit('authenticated', { id: id });
    io.emit('message', { id: id, text: 'Whatsapp is authenticated!' });
  });

  client.on('auth_failure', function() {
    io.emit('message', { id: id, text: 'Auth failure, restarting...' });
  });

  client.on('disconnected', (reason) => {
    io.emit('message', { id: id, text: 'Whatsapp is disconnected!' });
    client.destroy();
    client.initialize();

    // Menghapus pada file sessions
    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions.splice(sessionIndex, 1);
    setSessionsFile(savedSessions);

    io.emit('remove-session', id);
  });

  client.on('group_join', (notification) => {
    mentions = {
      id: {
        _serialized: notification.id.participant
      }
    }
    let welcomeMsg = 'Olá @' + notification.id.participant.split('@')[0] + ', bem vindo ao grupo!'
    notification.reply(welcomeMsg, { mentions: [mentions] });
});

client.on('group_leave', (notification) => {
  mentions = {
    id: {
      _serialized: notification.id.participant
    }
  }
  let welcomeMsg = 'Até mais @' + notification.id.participant.split('@')[0] + ', sentiremos saudade!'
  notification.reply(welcomeMsg, { mentions: [mentions] });
});

  // Tambahkan client ke sessions
  sessions.push({
    id: id,
    description: description,
    client: client
  });

  // Menambahkan session ke file
  const savedSessions = getSessionsFile();
  const sessionIndex = savedSessions.findIndex(sess => sess.id == id);

  if (sessionIndex == -1) {
    savedSessions.push({
      id: id,
      description: description,
      ready: false,
    });
    setSessionsFile(savedSessions);
  }

  

//   client.on('message', async msg => {
    
}

const dailyPassword = async function(){
  try {
    const today = new Date();
    const day = today.getDate();    
    const month = today.getMonth();  
    return day+month+'adm';
  } catch (error) {
    return error
  }
}

const init = function(socket) {
  const savedSessions = getSessionsFile();

  if (savedSessions.length > 0) {
    if (socket) {
      /**
       * At the first time of running (e.g. restarting the server), our client is not ready yet!
       * It will need several time to authenticating.
       * 
       * So to make people not confused for the 'ready' status
       * We need to make it as FALSE for this condition
       */
      savedSessions.forEach((e, i, arr) => {
        arr[i].ready = false;
      });

      socket.emit('init', savedSessions);
    } else {
      savedSessions.forEach(sess => {
        createSession(sess.id, sess.description);
      });
    }
  }
}

init();

// Socket IO
io.on('connection', function(socket) {
  init(socket);

  socket.on('create-session', function(data) {
    console.log('Create session: ' + data.id);
    createSession(data.id, data.description);
  });
});

const findGroupByName = async function (groupName,sender) {
  try {

    const client = await sessions.find(sess => sess.id == sender)?.client;

    const group = await client.getChats().then((chats) => {
      return chats.find(
        (chat) => chat.isGroup && chat.name.toLowerCase() == groupName.toLowerCase()
      );
    });
    return group;
  } catch (error) {
    console.error("Erro on findGroupByName");
    return 
  }
};


app.post('/send-message', async (req, res) => {
  if(!isEmptyObject(req.body)){
    return res.status(422).json({
      status: false,
      message: `The body was empty!`
    })
  }
  const sender = req.body.sender;
  const number = phoneNumberFormatter(req.body.number);
  const message = req.body.message;

  const client = await sessions.find(sess => sess.id == sender)?.client;

  // Make sure the sender is exists & ready
  if (!client) {
    return res.status(422).json({
      status: false,
      message: `The sender: ${sender} is not found!`
    })
  }

  /**
   * Check if the number is already registered
   * Copied from app.js
   * 
   * Please check app.js for more validations example
   * You can add the same here!
   */
  const isRegisteredNumber = await client.isRegisteredUser(number);

  if (!isRegisteredNumber) {
    return res.status(422).json({
      status: false,
      message: 'The number is not registered'
    });
  }

  client.sendMessage(number, message).then(response => {
    res.status(200).json({
      status: true,
      response: response
    });
  }).catch(err => {
    res.status(500).json({
      status: false,
      response: err
    });
  });
});

app.post('/send-message-group', async (req, res) => {
  if(!isEmptyObject(req.body)){
    return res.status(422).json({
      status: false,
      message: `The body was empty!`
    })
  }
  const sender = req.body.sender;
  const groupName = req.body.groupName;
  const message = req.body.message;

  const client = await sessions.find(sess => sess.id == sender)?.client;

  // Make sure the sender is exists & ready
  if (!client) {
    return res.status(422).json({
      status: false,
      message: `The sender: ${sender} is not found!`
    })
  }
  const group = await findGroupByName(groupName,sender);

  if (!group) {
    return res.status(422).json({
      status: false,
      message: `The group ${groupName} was not found!`
    });
  }

  client.sendMessage(group.id._serialized, message).then(response => {
    res.status(200).json({
      status: true,
      response: response
    });
  }).catch(err => {
    res.status(500).json({
      status: false,
      response: err
    });
  });
});

app.post('/send-message-media', async (req, res) => {
  if(!isEmptyObject(req.body)){
    return res.status(422).json({
      status: false,
      message: `The body was empty!`
    })
  }

  const sender = req.body.sender;
  const number = phoneNumberFormatter(req.body.number);
  const caption = req.body.caption;
  const fileUrl = req.body.file;

  const client = await sessions.find(sess => sess.id == sender)?.client;

   // Make sure the sender is exists & ready
   if (!client) {
    return res.status(422).json({
      status: false,
      message: `The sender: ${sender} is not found!`
    })
  }

  let mimetype;
  let nameMedia;
  const attachment = await axios.get(fileUrl, {
    responseType: 'arraybuffer'
  }).then(response => {
    nameMedia = response.headers['content-disposition'];
    mimetype = response.headers['content-type'];
    return response.data.toString('base64');
  });

  if (nameMedia) {
    nameFormated = nameMedia.slice(
      nameMedia.indexOf("=") + 1,
      nameMedia.indexOf(".")
    );
    if (nameMedia.toUpperCase().includes("UNTITLED")) {
      nameMedia = "Media";
    }
  }else{
    nameMedia = "Media";
  }

  const media = new MessageMedia(mimetype, attachment, nameMedia);

  client.sendMessage(number, media, {
    caption: caption
  }).then(response => {
    if(mimetype == 'application/pdf'){
    response.reply(caption);
    }
    res.status(200).json({
      status: true,
      response: response
    });
  }).catch(err => {
    res.status(500).json({
      status: false,
      response: err
    });
  });
});

app.post('/send-message-group-media', async (req, res) => {
  if(!isEmptyObject(req.body)){
    return res.status(422).json({
      status: false,
      message: `The body was empty!`
    })
  }

  const sender = req.body.sender;
  const groupName = req.body.groupName;
  const caption = req.body.caption;
  const fileUrl = req.body.file;

  const client = await sessions.find(sess => sess.id == sender)?.client;

   // Make sure the sender is exists & ready
   if (!client) {
    return res.status(422).json({
      status: false,
      message: `The sender: ${sender} is not found!`
    })
  }

  let mimetype;
  let nameMedia;
  const attachment = await axios.get(fileUrl, {
    responseType: 'arraybuffer'
  }).then(response => {
    nameMedia = response.headers['content-disposition'];
    mimetype = response.headers['content-type'];
    return response.data.toString('base64');
  });

  if (nameMedia) {
    nameFormated = nameMedia.slice(
      nameMedia.indexOf("=") + 1,
      nameMedia.indexOf(".")
    );
    if (nameMedia.toUpperCase().includes("UNTITLED")) {
      nameMedia = "Media";
    }
  }else{
    nameMedia = "Media";
  }

  const group = await findGroupByName(groupName,sender);
  
  if (!group) {
    return res.status(422).json({
      status: false,
      message: `The group ${groupName} was not found!`
    });
  }

  const media = new MessageMedia(mimetype, attachment, nameMedia); 

  client.sendMessage(group.id._serialized, media, {
    caption: caption
  }).then(response => {
    if(mimetype == 'application/pdf'){
    response.reply(caption);
    }
    res.status(200).json({
      status: true,
      response: response
    });
  }).catch(err => {
    res.status(500).json({
      status: false,
      response: err
    });
  });
});

app.post('/group-join', async (req, res) => {
  if(!isEmptyObject(req.body)){
    return res.status(422).json({
      status: false,
      message: `The body was empty!`
    })
  }
try{
  const sender = req.body.sender;
  const invite = req.body.invite;

  const client = await sessions.find(sess => sess.id == sender)?.client;
  // Make sure the sender is exists & ready
  if (!client) {
    return res.status(422).json({
      status: false,
      message: `The sender: ${sender} is not found!`
    })
  }

  const inviteCode = invite.split(' ')[0];
  try {
      await client.acceptInvite(inviteCode);

      res.status(200).json({
        status: true,
        response: 'Joined the group!'
      });
  } catch (e) {
    res.status(500).json({
      status: false,
      response: 'That invite code seems to be invalid.'
    });
  }
}catch
{
  return res.status(422).json({
    status: false,
    message: `The body is not correct`
  })
}
});

app.post('/group-leave', async (req, res) => {
  if(!isEmptyObject(req.body)){
    return res.status(422).json({
      status: false,
      message: `The body was empty!`
    })
  }
try{
  const sender = req.body.sender;
  const groupName = req.body.groupName;

  const client = await sessions.find(sess => sess.id == sender)?.client;
  // Make sure the sender is exists & ready
  if (!client) {
    return res.status(422).json({
      status: false,
      message: `The sender: ${sender} is not found!`
    })
  }

  const group = await findGroupByName(groupName,sender);
    if(!group){
      return res.status(422).json({
        status: false,
        message: `The group: ${groupName} is not found!`
      })
    }

    try {
      if(group.isGroup){
        group.leave();
        group.delete();
        res.status(200).json({
          status: true,
          response: 'Leaved the group!'
        });
      }else{
        return res.status(422).json({
          status: false,
          message: `The name: ${groupName} is not a group!`
        });
      }
    } catch (error) {
      return res.status(422).json({
        status: false,
        message: `Something is wrong, please see the details: ${error}`
      });
    }


}catch
{
  return res.status(422).json({
    status: false,
    message: `The body is not correct`
  })
}
});

app.post('/group-addParticipant', async (req, res) => {
  if(!isEmptyObject(req.body)){
    return res.status(422).json({
      status: false,
      message: `The body was empty!`
    })
  }
try{
  const sender = req.body.sender;
  const groupName = req.body.groupName;
  const number = phoneNumberFormatter(req.body.number);

  const client = await sessions.find(sess => sess.id == sender)?.client;
  // Make sure the sender is exists & ready
  if (!client) {
    return res.status(422).json({
      status: false,
      message: `The sender: ${sender} is not found!`
    })
  }

  const isRegisteredNumber = await client.isRegisteredUser(number);

  if (!isRegisteredNumber) {
    return res.status(422).json({
      status: false,
      message: `The number ${number} is not registered`
    });
  }

  const chat = await client.getChatById(number);
  let chatId;
  const group = await findGroupByName(groupName,sender);
    if(!group){
      return res.status(422).json({
        status: false,
        message: `The group: ${groupName} is not found!`
      })
    }
    try {
      if(group.isGroup){
        group.addParticipants([chat.id._serialized]).then((result)=>{
          res.status(200).json({
            status: true,
            response: `The number ${number} was addeded to the group ${groupName}!`
          });
        }).catch((err)=>{
          return res.status(422).json({
            status: false,
            message: `Something is wrong, please see the details: ${err}`
          });
        });
       
      }else{
        return res.status(422).json({
          status: false,
          message: `The name: ${groupName} is not a group!`
        });
      }
    } catch (error) {
      return res.status(422).json({
        status: false,
        message: `Something is wrong, please see the details: ${error}`
      });
    }
}catch
{
  return res.status(422).json({
    status: false,
    message: `The body is not correct`
  })
}
});

app.post('/group-removeParticipant', async (req, res) => {
  if(!isEmptyObject(req.body)){
    return res.status(422).json({
      status: false,
      message: `The body was empty!`
    })
  }
try{
  const sender = req.body.sender;
  const groupName = req.body.groupName;
  const number = phoneNumberFormatter(req.body.number);

  const client = await sessions.find(sess => sess.id == sender)?.client;
  // Make sure the sender is exists & ready
  if (!client) {
    return res.status(422).json({
      status: false,
      message: `The sender: ${sender} is not found!`
    })
  }

  const isRegisteredNumber = await client.isRegisteredUser(number);

  if (!isRegisteredNumber) {
    return res.status(422).json({
      status: false,
      message: `The number ${number} is not registered!`
    });
  }

  const chat = await client.getChatById(number);
  let chatId;
  const group = await findGroupByName(groupName,sender);
    if(!group){
      return res.status(422).json({
        status: false,
        message: `The group: ${groupName} is not found!`
      })
    }
    try {
      if(group.isGroup){
        group.removeParticipants([chat.id._serialized]).then((result)=>{
          res.status(200).json({
            status: true,
            response: `The number ${number} was removed to the group ${groupName}!`
          });
        }).catch((err)=>{
          return res.status(422).json({
            status: false,
            message: `Something is wrong, please see the details: ${err}`
          });
        });
       
      }else{
        return res.status(422).json({
          status: false,
          message: `The name: ${groupName} is not a group!`
        });
      }
    } catch (error) {
      return res.status(422).json({
        status: false,
        message: `Something is wrong, please see the details: ${error}`
      });
    }
}catch
{
  return res.status(422).json({
    status: false,
    message: `The body is not correct`
  })
}
});

app.post('/group-changeGroupName', async (req, res) => {
  if(!isEmptyObject(req.body)){
    return res.status(422).json({
      status: false,
      message: `The body was empty!`
    })
  }
try{
  const sender = req.body.sender;
  const groupName = req.body.groupName;
  const subject = req.body.subject;

  const client = await sessions.find(sess => sess.id == sender)?.client;
  // Make sure the sender is exists & ready
  if (!client) {
    return res.status(422).json({
      status: false,
      message: `The sender: ${sender} is not found!`
    })
  }

  const group = await findGroupByName(groupName,sender);
    if(!group){
      return res.status(422).json({
        status: false,
        message: `The group: ${groupName} is not found!`
      })
    }
    try {
      if(group.isGroup){
        group.setSubject(subject).then((result)=>{
          res.status(200).json({
            status: true,
            response: `The name "${subject}" was defined to the group ${groupName}!`
          });
        }).catch((err)=>{
          return res.status(422).json({
            status: false,
            message: `Something is wrong, please see the details: ${err}`
          });
        });
       
      }else{
        return res.status(422).json({
          status: false,
          message: `The name: ${groupName} is not a group!`
        });
      }
    } catch (error) {
      return res.status(422).json({
        status: false,
        message: `Something is wrong, please see the details: ${error}`
      });
    }
}catch {
  return res.status(422).json({
    status: false,
    message: `The body is not correct`
  })
}
});

app.post('/group-setDescription', async (req, res) => {
  if(!isEmptyObject(req.body)){
    return res.status(422).json({
      status: false,
      message: `The body was empty!`
    })
  }
try{
  const sender = req.body.sender;
  const groupName = req.body.groupName;
  const description = req.body.description;

  const client = await sessions.find(sess => sess.id == sender)?.client;
  // Make sure the sender is exists & ready
  if (!client) {
    return res.status(422).json({
      status: false,
      message: `The sender: ${sender} is not found!`
    })
  }

  const group = await findGroupByName(groupName,sender);
    if(!group){
      return res.status(422).json({
        status: false,
        message: `The group: ${groupName} is not found!`
      })
    }
    try {
      if(group.isGroup){
        group.setDescription(description).then((result)=>{
          res.status(200).json({
            status: true,
            response: `The description "${description}" was defined to the group ${groupName}!`
          });
        }).catch((err)=>{
          return res.status(422).json({
            status: false,
            message: `Something is wrong, please see the details: ${err}`
          });
        });
       
      }else{
        return res.status(422).json({
          status: false,
          message: `The name: ${groupName} is not a group!`
        });
      }
    } catch (error) {
      return res.status(422).json({
        status: false,
        message: `Something is wrong, please see the details: ${error}`
      });
    }
}catch {
  return res.status(422).json({
    status: false,
    message: `The body is not correct`
  })
}
});

app.post('/group-setMessagesAdminsOnly', async (req, res) => {
  if(!isEmptyObject(req.body)){
    return res.status(422).json({
      status: false,
      message: `The body was empty!`
    })
  }
try{
  const sender = req.body.sender;
  const groupName = req.body.groupName;
  const adminsOnly = req.body.adminsOnly;

  const client = await sessions.find(sess => sess.id == sender)?.client;
  // Make sure the sender is exists & ready
  if (!client) {
    return res.status(422).json({
      status: false,
      message: `The sender: ${sender} is not found!`
    })
  }

  const group = await findGroupByName(groupName,sender);
    if(!group){
      return res.status(422).json({
        status: false,
        message: `The group: ${groupName} is not found!`
      })
    }
    try {
      if(group.isGroup){
        group.setMessagesAdminsOnly(adminsOnly).then((result)=>{
          res.status(200).json({
            status: true,
            response: `The messages admins only was defined to ${adminsOnly} on the group ${groupName}!`
          });
        }).catch((err)=>{
          return res.status(422).json({
            status: false,
            message: `Something is wrong, please see the details: ${err}`
          });
        });
       
      }else{
        return res.status(422).json({
          status: false,
          message: `The name: ${groupName} is not a group!`
        });
      }
    } catch (error) {
      return res.status(422).json({
        status: false,
        message: `Something is wrong, please see the details: ${error}`
      });
    }
}catch {
  return res.status(422).json({
    status: false,
    message: `The body is not correct`
  })
}
});

app.post('/group-setInfoAdminsOnly', async (req, res) => {
  if(!isEmptyObject(req.body)){
    return res.status(422).json({
      status: false,
      message: `The body was empty!`
    })
  }
try{
  const sender = req.body.sender;
  const groupName = req.body.groupName;
  const infoAdminsOnly = req.body.infoAdminsOnly;

  const client = await sessions.find(sess => sess.id == sender)?.client;
  // Make sure the sender is exists & ready
  if (!client) {
    return res.status(422).json({
      status: false,
      message: `The sender: ${sender} is not found!`
    })
  }

  const group = await findGroupByName(groupName,sender);
    if(!group){
      return res.status(422).json({
        status: false,
        message: `The group: ${groupName} is not found!`
      })
    }
    try {
      if(group.isGroup){
        group.setInfoAdminsOnly(infoAdminsOnly).then((result)=>{
          res.status(200).json({
            status: true,
            response: `The info admins only was defined to ${infoAdminsOnly} on the group ${groupName}!`
          });
        }).catch((err)=>{
          return res.status(422).json({
            status: false,
            message: `Something is wrong, please see the details: ${err}`
          });
        });
       
      }else{
        return res.status(422).json({
          status: false,
          message: `The name: ${groupName} is not a group!`
        });
      }
    } catch (error) {
      return res.status(422).json({
        status: false,
        message: `Something is wrong, please see the details: ${error}`
      });
    }
}catch {
  return res.status(422).json({
    status: false,
    message: `The body is not correct`
  })
}
});

app.post('/group-promoteParticipant', async (req, res) => {
  if(!isEmptyObject(req.body)){
    return res.status(422).json({
      status: false,
      message: `The body was empty!`
    })
  }
try{
  const sender = req.body.sender;
  const groupName = req.body.groupName;
  const number = phoneNumberFormatter(req.body.number);

  const client = await sessions.find(sess => sess.id == sender)?.client;
  // Make sure the sender is exists & ready
  if (!client) {
    return res.status(422).json({
      status: false,
      message: `The sender: ${sender} is not found!`
    })
  }

  const isRegisteredNumber = await client.isRegisteredUser(number);

  if (!isRegisteredNumber) {
    return res.status(422).json({
      status: false,
      message: `The number ${number} is not registered!`
    });
  }

  const chat = await client.getChatById(number);
  let chatId;
  const group = await findGroupByName(groupName,sender);
    if(!group){
      return res.status(422).json({
        status: false,
        message: `The group: ${groupName} is not found!`
      })
    }
    try {
      if(group.isGroup){
        group.promoteParticipants([chat.id._serialized]).then((result)=>{
          res.status(200).json({
            status: true,
            response: `The number ${number} was pomoted on the group ${groupName}!`
          });
        }).catch((err)=>{
          return res.status(422).json({
            status: false,
            message: `Something is wrong, please see the details: ${err}`
          });
        });
       
      }else{
        return res.status(422).json({
          status: false,
          message: `The name: ${groupName} is not a group!`
        });
      }
    } catch (error) {
      return res.status(422).json({
        status: false,
        message: `Something is wrong, please see the details: ${error}`
      });
    }
}catch
{
  return res.status(422).json({
    status: false,
    message: `The body is not correct`
  })
}
});

app.post('/group-demoteParticipant', async (req, res) => {
  if(!isEmptyObject(req.body)){
    return res.status(422).json({
      status: false,
      message: `The body was empty!`
    })
  }
try{
  const sender = req.body.sender;
  const groupName = req.body.groupName;
  const number = phoneNumberFormatter(req.body.number);

  const client = await sessions.find(sess => sess.id == sender)?.client;
  // Make sure the sender is exists & ready
  if (!client) {
    return res.status(422).json({
      status: false,
      message: `The sender: ${sender} is not found!`
    })
  }

  const isRegisteredNumber = await client.isRegisteredUser(number);

  if (!isRegisteredNumber) {
    return res.status(422).json({
      status: false,
      message: `The number ${number} is not registered!`
    });
  }

  const chat = await client.getChatById(number);
  let chatId;
  const group = await findGroupByName(groupName,sender);
    if(!group){
      return res.status(422).json({
        status: false,
        message: `The group: ${groupName} is not found!`
      })
    }
    try {
      if(group.isGroup){
        group.demoteParticipants([chat.id._serialized]).then((result)=>{
          res.status(200).json({
            status: true,
            response: `The number ${number} was demoted on the group ${groupName}!`
          });
        }).catch((err)=>{
          return res.status(422).json({
            status: false,
            message: `Something is wrong, please see the details: ${err}`
          });
        });
       
      }else{
        return res.status(422).json({
          status: false,
          message: `The name: ${groupName} is not a group!`
        });
      }
    } catch (error) {
      return res.status(422).json({
        status: false,
        message: `Something is wrong, please see the details: ${error}`
      });
    }
}catch
{
  return res.status(422).json({
    status: false,
    message: `The body is not correct`
  })
}
});


server.listen(port, function() {
  console.log('App running on *: ' + port);
});
