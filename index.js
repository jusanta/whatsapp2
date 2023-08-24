const fs = require('fs');
const express = require('express');
const app = express();
const router = express.Router();
const cors = require('cors')
const { Client, MessageMedia, LegacySessionAuth, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
// const qrcodeTerminal = require('qrcode-terminal');
const axios = require('axios');
const corsConfig = {
	origin: ['https://siutebrainsprueba.web.app', 'http://localhost:8080', 'https://suitebrains.com']
}
const SESSIONES_PATH = './sesiones/';
const ARCHIVOS_PATH = './archivos_ws/';

const AMBIENTE = '/';
const PUERTO = 3000;
// const AMBIENTE = '/pruebas/';
// const PUERTO = 3001;

app.use(cors(corsConfig));
app.use(express.json({limit: '16mb'}));
app.use(express.urlencoded({limit: '16mb', extended: true}));
// app.use(async function (req, res, next) {
//     let idToken = req.headers.authorization?.split('Bearer ')[1];
//     let hostConsumo = req.query.hostConsumo;
//     let url = getUrl(hostConsumo);
//     let axiosLib = getAxiosLib(url, idToken);

//     let continuar = await axiosLib.post(
//         '/seguridad-vt'
//     ).then(
//         function (response) {
//             // console.log(response);
//             return true;
//         }.bind(this)
//     ).catch(
//         function (error) {
//             return false;
//         }.bind(this)
//     );

//     if (continuar) {
//         next();
//     } else {
//         res.status(401).send('You are not authorized to perform this action');
//     }
// });
global.clientesWs = {};

restaurarSesiones();


function initClient(infoInit) {
    let client = getClient(infoInit);
    client.initialize();
    global.clientesWs[infoInit.idOrganizacion] = client;

    client.on('qr', (qr) => {
        // Generate and scan this code with your phone
        console.log('QR RECEIVED: ', infoInit.fecha);
        generateQRCode(qr, infoInit.idOrganizacion);
    });

    client.on('ready', () => {
        global.clientesWs[infoInit.idOrganizacion].ready = true;
        console.log('Client is ready!');
        
    });

    // Save session values to the file upon successful auth
    client.on('authenticated', (session) => {
        // sessionData = session;
        try {
            let sessionObj = {
                idOrganizacion: infoInit.idOrganizacion,
                session: session,
                hostConsumo: infoInit.hostConsumo,
                idToken: infoInit.idToken,
                msgBienvenida: infoInit.msgBienvenida,
                horaIni: infoInit.horaIni,
                horaFin: infoInit.horaFin,
                msgHorario: infoInit.msgHorario
            }

            fs.writeFile(SESSIONES_PATH + infoInit.idOrganizacion, JSON.stringify(sessionObj), (err) => {
                if (err) {
                    console.error(err);
                }
            });
        } catch (error) {
            console.log(error);
        }
            
    });

    client.on('disconnected', (reason) => {
        clearSesion(infoInit.idOrganizacion, null);
    });
    

    client.on('message', async msg => {
        
        console.log(msg);
        try {
            let codArea = await client.getCountryCode(msg.from);
            let telefonoMovilFrom= await getTelefonoMovil(client, msg.from, codArea) ;
            let telefonoMovilTo= msg.to;
            
            let infoInicio = {
                codArea: "+" + codArea,
                telefonoMovilFrom: telefonoMovilFrom,
                telefonoMovilFromOriginal: msg.from,
                telefonoMovilTo: telefonoMovilTo.substring(2, 12),
                body: getTextoMensaje(msg),
                client: client,
                hostConsumo: infoInit.hostConsumo,
                idMessage: getIdMsg(msg),
                msgType: getMsgType(msg),
                msgBienvenida: infoInit.msgBienvenida,
                msgHorario: infoInit.msgHorario,
                horaIni: infoInit.horaIni, 
                horaFin: infoInit.horaFin
            }

            if (!msg.from.includes("atus@broad") && infoInicio.msgType != 'e2e_notification') {

                if(client.controlConcurrencia[infoInicio.telefonoMovilFrom]){
                    setTimeout(function(){addMessage(infoInicio, msg); }, 4000 );
                } else {
                    addMessage(infoInicio, msg);
                }

                // if (msg.type != 'chat' && msg.type != 'image') {
                //     msg.reply('Gracias por comunicarte con nosotros, actualmente nuestra plataforma solo puede recibir mensajes de texto o imagenes.');
                // }

            }
        } catch (error) {
            console.log(new Date() + ' - Num Cel: ' + msg.from + ' - ' + error)
        }
            
        
    });

    if (infoInit.response) {
        infoInit.response.send("Cliente whatsapp inicializado, pendiente al inicio de sesion.");
    }
}

function getIdMsg(msg) {
    let idMsg = msg.id;

    if (msg._data && msg._data.quotedMsg && msg._data.quotedStanzaID) {
        idMsg.idQuotedMsg = msg._data.quotedStanzaID;

    }

    return idMsg;

}

function getMsgType(msg) {
    let type =msg.type;

    if (msg._data && msg._data.quotedMsg && msg._data.quotedMsg.type) {
        type = msg._data.quotedMsg.type;

    }

    return type;

}

function getTextoMensaje(msg) {
    let texto = '';

    try {

        if (msg._data && msg._data.quotedMsg && msg._data.quotedStanzaID) {
            if (msg._data.quotedMsg.type == 'chat') {
                texto += '(Mensaje referenciado: ' + msg._data.quotedMsg.body + ' ).' + '\n';
            } else {
                texto = '(Mensaje referenciado): ';
            }
        }

        if (msg.body) {
            texto += '\n' + msg.body;
        }
    
        if (msg.title && !texto.includes(msg.title)) {
            texto += '\n' + msg.title;
        }
    
        if (msg.description && !texto.includes(msg.description)) {
            texto += '\n' + msg.description;
        }
    
        if (msg.links && msg.links.length > 0) {
            for (const linkObj of msg.links) {
                if (!texto.includes(linkObj.link)) {
                    texto += '\n' + linkObj.link;
                }
            } 
        }

        if (msg._data && msg._data.ctwaContext) {
            texto += '\n' + msg._data.ctwaContext.sourceUrl;
            texto += '\n' + msg._data.ctwaContext.description;

        }
    } catch (error) {
        texto = msg.body;
    }

    return texto;
}

function getClient(infoInit) {
    let client = new Client({
        restartOnAuthFail: true,
        authStrategy: new LocalAuth({ clientId: infoInit.idOrganizacion, dataPath: SESSIONES_PATH}),
        puppeteer: {
		args: ['--no-sandbox'],
	}
        /*qrMaxRetries:1,*/
        // authStrategy: new LegacySessionAuth({
        //     session: infoInit.session
        // })
    });
    client["idOrganizacion"] = infoInit.idOrganizacion;
    client["controlConcurrencia"] = {};
    client["idToken"] = infoInit.idToken;
    client["ready"] = false;
    client["base64QrCodeWs"] = null;

    return client;
}

const generateQRCode = async (qr, idOrganizacion) => {
    try {
        // await qrcodeTerminal.generate(qr, {small: true});
        
        if (global.clientesWs[idOrganizacion] && !global.clientesWs[idOrganizacion].ready) {
            global.clientesWs[idOrganizacion].base64QrCodeWs = await qrcode.toDataURL(qr);
        }
        
    } catch (err) {
    }
}

async function getTelefonoMovil(client, telefonoMovil, codArea) {
    
    let number;
    try {
        console.log("");
        console.log(new Date() + ' - Num Cel: ' + telefonoMovil + ' - Entrada mensaje');

        if (!telefonoMovil.includes("status@broadcast")) {
            number = await client.getNumberId(telefonoMovil);
            console.log(new Date() + ' - Num Cel: ' + telefonoMovil + ' - Number from client.getNumberId: ' + number.user);
            number = "+" + number.user;
            number = number.split("+" + codArea)[1];
        }

    } catch (error) {
        console.log(new Date() + ' - Num Cel: ' + telefonoMovil + ' - ' + error)
        number = telefonoMovil.substring(2, 12)
    }

    return number;
}

async function addMessage(infoInicio, message) {
    infoInicio.client.controlConcurrencia[infoInicio.telefonoMovilFrom] = true;
    let url = getUrl(infoInicio.hostConsumo);
    let persona = null;
    let axiosLib = getAxiosLib(url, infoInicio.client.idToken);
    let usuarioNuevo = false;

    try {
        
        // persona = await axiosLib.get(
        //     '/personas-getPersonaFromMovil',
        //     {params: {
        //         idOrganizacion: infoInicio.client.idOrganizacion,
        //         telefonoMovil: infoInicio.telefonoMovilFrom
        //     }}
        // );
        // persona = persona.data;

        // if (!persona) {
        persona = await axiosLib.post(
            '/personas-crearPersonaTemporal',
            {
                idOrganizacion: infoInicio.client.idOrganizacion,
                codArea: infoInicio.codArea,
                telefonoMovil: infoInicio.telefonoMovilFrom
            }
        ).catch((error) => {
            console.error(new Date() + ' - Se presento un error tratando de consultar o crear la persona: ', error);

        });
        persona = persona.data;
        usuarioNuevo = persona.nueva;
        // }
        console.log(new Date() + ' - Num Cel: ' +  infoInicio.telefonoMovilFromOriginal + ' - personas-crearPersonaTemporal');
        
        if (persona) {
            await sendMensajesAutomaticos(infoInicio, persona, usuarioNuevo);
            console.log(new Date() + ' - Num Cel: ' +  infoInicio.telefonoMovilFromOriginal + ' - sendMensajesAutomaticos');

            let mensaje = {
                remitente: infoInicio.telefonoMovilFrom,
                destinatario: infoInicio.telefonoMovilTo,
                idPersona: persona.idPersona,
                contenido: infoInicio.body,
                origen:"ws",
                idGrupoInformacion: persona.idGrupoInformacion,
                mySelf: false,
                idUsuarioAsesor: persona.idUsuarioAsesor,
                type: infoInicio.msgType,
                idMsg: infoInicio.idMessage,
                idOrganizacion: infoInicio.client.idOrganizacion,
                visto: false
            };

            let infoPersona = {
                idOrganizacion: infoInicio.client.idOrganizacion,
                idPersona: persona.idPersona
            }

            let rta = await axiosLib.post(
                '/personas-actualizarInfoMensajeria',
                infoPersona
            ).catch((error) => {
                console.error(new Date() + ' - Se presento un error en el servicio : (/personas-actualizarInfoMensajeria)', error);
    
            });

            console.log(new Date() + ' - Num Cel: ' +  infoInicio.telefonoMovilFromOriginal + ' - personas-actualizarInfoMensajeria');

            rta = await axiosLib.post(
                '/mensajeria-addMessage',
                mensaje
            ).catch((error) => {
                console.error(new Date() + ' - Se presento un error en el servicio : (/mensajeria-addMessage)', error);
    
            });

            console.log(new Date() + ' - Num Cel: ' +  infoInicio.telefonoMovilFromOriginal + ' - mensajeria-addMessage');
        
            almacenarArchivo(message, infoInicio.client.idOrganizacion, persona.idPersona);
        } else {
            console.error(new Date() + ' - No se logro obtener una persona valida - : ');

        }

        infoInicio.client.controlConcurrencia[infoInicio.telefonoMovilFrom] = false;

    } catch (error) {
        infoInicio.client.controlConcurrencia[infoInicio.telefonoMovilFrom] = false;
        console.error(new Date() + " - Se presento un error insertando los mensajes", error);
    }
}

async function almacenarArchivo(mensaje, idOrganizacion, idPersona, msgMediaParam) {
    try {
        if (mensaje.hasMedia) {
            let pathArchivos = ARCHIVOS_PATH + idOrganizacion + "/" + idPersona + "/";
            if(!fs.existsSync(pathArchivos)) {
                fs.mkdirSync(pathArchivos,{recursive:true});
            }
            let imgBase64;
           
            let msgMedia;
            if (msgMediaParam) {
                msgMedia = msgMediaParam;
            } else {
                msgMedia = await mensaje.downloadMedia();
            }
            
            imgBase64 = "data:" + msgMedia.mimetype + ";base64," + msgMedia.data;

            fs.writeFile(pathArchivos + mensaje.id.id, imgBase64, (err) => {
                if (err) {
                    console.error(err);
                }
            });
        }
    } catch (error) {
        console.error(new Date() + " - Se presento un error almacenando el archivo.", error);
    }
    
    
}

function getMessageMedia(idOrganizacion, idPersona, idMessage) {
    let pathArchivos = ARCHIVOS_PATH + idOrganizacion + "/" + idPersona + "/" + idMessage;
    let imgBase64;
    if(fs.existsSync(pathArchivos) && fs.lstatSync(pathArchivos).isFile()) {
        imgBase64= fs.readFileSync(pathArchivos, 'utf-8');
    }
    return imgBase64;
}

async function sendMensajesAutomaticos(infoInicio, persona, usuarioNuevo){
    try {
        let timeFechaActual = new Date().getTime();
        let timeFechaBloqueoMsgAutomaticos;
        const LEADS= 2;
        
        if (persona.fechaHastaBloqueoMsgAutomaticos) {
            timeFechaBloqueoMsgAutomaticos = new Date(0);
            timeFechaBloqueoMsgAutomaticos.setSeconds(persona.fechaHastaBloqueoMsgAutomaticos._seconds);
            timeFechaBloqueoMsgAutomaticos = timeFechaBloqueoMsgAutomaticos.getTime();
        } else {
            timeFechaBloqueoMsgAutomaticos = timeFechaActual;
        }

        if (persona.idTipoPersona == LEADS && timeFechaActual >= timeFechaBloqueoMsgAutomaticos) {
            await verificarHorarioLaboral(infoInicio, persona, usuarioNuevo);
        }
    } catch (error) {
        console.error(new Date() + " - Se presento un error tratando de verificar el envio de mensajes automaticos", error);
    }
    
}

async function verificarHorarioLaboral(infoInicio, persona, usuarioNuevo){
    try {
        if (infoInicio.horaIni && infoInicio.horaIni.split(':').length == 2 && infoInicio.horaFin && infoInicio.horaFin.split(':').length == 2) {
            let horaDesde = infoInicio.horaIni.split(':')[0];
            let minuteDesde = infoInicio.horaIni.split(':')[1];
            let horaHasta = infoInicio.horaFin.split(':')[0];
            let minuteHasta = infoInicio.horaFin.split(':')[1];
            let fechaDesde = new Date();
            let fechaHasta = new Date();
            fechaDesde.setHours(horaDesde, minuteDesde);
            fechaHasta.setHours(horaHasta, minuteHasta);
            let timeFechaDesde = fechaDesde.getTime();
            let timeFechaHasta = fechaHasta.getTime();
            let timeFechaActual = new Date().getTime();
            if (timeFechaActual < timeFechaDesde || timeFechaActual > timeFechaHasta) {
                // let msgTexto = 'Nuestro horario laboral va desde las ' + infoInicio.horaIni + ' hasta las ' + infoInicio.horaFin;
                let msgTexto = infoInicio.msgHorario;

                if (msgTexto) {
                    msgTexto = msgTexto.replace('{horaIni}', convert24toAmPm(infoInicio.horaIni)).replace('{horaFin}', convert24toAmPm(infoInicio.horaFin));
                    let message = await infoInicio.client.sendMessage(infoInicio.telefonoMovilFromOriginal, msgTexto);
                    await addMessageBd(infoInicio, persona, message.id, msgTexto);
                }
            
            } else {
                await sendMsgBienvenida(infoInicio, persona, usuarioNuevo);

            }
        }
    } catch (error) {
        console.error(new Date() + " - Se presento un error tratando de calcular los horarios laborales", error);
    }
        
}

function convert24toAmPm (time) {
    // Check correct time format and split into components
    time = time.toString ().match (/^([01]\d|2[0-3])(:)([0-5]\d)(:[0-5]\d)?$/) || [time];
  
    if (time.length > 1) { // If time format correct
      time = time.slice (1);  // Remove full string match value
      time[5] = +time[0] < 12 ? 'AM' : 'PM'; // Set AM/PM
      time[0] = +time[0] % 12 || 12; // Adjust hours
    }
    return time.join (''); // return adjusted time or original string
}

async function sendMsgBienvenida(infoInicio, persona, usuarioNuevo){
    try {
        const VEINTICUATRO_HORAS_MILISECONDS = 24*60*60*1000;
        var fechaActual = new Date();
        var fechaUltimoMensaje = new Date(0);

        if (persona.fechaUltimoMensaje) {
            fechaUltimoMensaje.setSeconds(persona.fechaUltimoMensaje._seconds);
        }

        var diferencia_miliseconds = fechaActual.getTime() - fechaUltimoMensaje.getTime();

        if ((usuarioNuevo || diferencia_miliseconds > VEINTICUATRO_HORAS_MILISECONDS)&& infoInicio.msgBienvenida) {
            let message = await infoInicio.client.sendMessage(infoInicio.telefonoMovilFromOriginal, infoInicio.msgBienvenida);
            await addMessageBd(infoInicio, persona, message.id, infoInicio.msgBienvenida);
        }
    } catch (error) {
        console.error(new Date() + " - Se presento un error tratando de enviar el mensaje de bienvenida", error);
    }
        
    
}

async function addMessageBd(infoInicio, persona, idMsg, msg){
    let mensaje = {
        remitente: null,
        destinatario: infoInicio.telefonoMovilFrom,
        idPersona: persona.idPersona,
        contenido: msg,
        origen:"ws",
        idGrupoInformacion: persona.idGrupoInformacion,
        mySelf: true,
        idUsuarioAsesor: persona.idUsuarioAsesor,
        type: 'chat',
        idMsg: idMsg,
        idOrganizacion: infoInicio.client.idOrganizacion,
        visto: true
    };
    let url = getUrl(infoInicio.hostConsumo);
    let axiosLib = getAxiosLib(url, infoInicio.client.idToken);

    await axiosLib.post(
        '/mensajeria-addMessage',
        mensaje
    ).catch((error) => {
        console.error(new Date() + ' - Se presento un error en el servicio : (/mensajeria-addMessage)', error);

    });
}

function restaurarSesiones(){
    let sessionData;

    fs.readdir(SESSIONES_PATH, function (err, archivos) {
        if (err) {
           // onError(err);
            return;
        }
        
        for (const session of archivos) {
            try {
                if(fs.existsSync(SESSIONES_PATH + session) && fs.lstatSync(SESSIONES_PATH + session).isFile()) {
                    sessionData= JSON.parse(fs.readFileSync(SESSIONES_PATH + session));
                    
                    let infoInit = {
                        session: sessionData.session,
                        idOrganizacion: sessionData.idOrganizacion,
                        hostConsumo: sessionData.hostConsumo,
                        idToken: sessionData.idToken,
                        msgBienvenida: sessionData.msgBienvenida,
                        horaIni: sessionData.horaIni,
                        horaFin: sessionData.horaFin,
                        msgHorario: sessionData.msgHorario,
                        response: null
                    }

                    if (sessionData) {
                        initClient(infoInit);
                    }
                } else if(fs.existsSync(SESSIONES_PATH + session) && fs.lstatSync(SESSIONES_PATH + session).isDirectory()) {
                    try {
                        let idSesion = session.split('-')[1];
                        if (!fs.existsSync(SESSIONES_PATH + idSesion)) {
                            // Eliminamos la sesion almacenada en disco asociada a la organizacion.
                            deleteFolderRecursive(SESSIONES_PATH + session);
                            
                        }
            
                    } catch(err) {
                        console.error('Error eliminando la carpeta de sesion de puppeter', err);
                    }
                }
            } catch (error) {
                console.log(error);

                try {
                    // Eliminamos la sesion almacenada en disco asociada a la organizacion en caso de que se presenta algun error.
                    if(fs.existsSync(SESSIONES_PATH + session) && fs.lstatSync(SESSIONES_PATH + session).isFile()) {
                        fs.unlinkSync(SESSIONES_PATH + session);
                        deleteFolderRecursive(SESSIONES_PATH + 'session-' + session);
                    }

                    if(fs.existsSync(SESSIONES_PATH + session) && fs.lstatSync(SESSIONES_PATH + session).isDirectory()) {
                        let idSesion = session.split('-')[1];
                        if (fs.existsSync(SESSIONES_PATH + idSesion)) {
                            fs.unlinkSync(SESSIONES_PATH + idSesion);
                            
                        }
                        deleteFolderRecursive(SESSIONES_PATH + session);
                    }

                } catch(err) {
                    console.error('Something wrong happened removing the file', err)
                }

            }

        }
    });
}

function deleteFolderRecursive(path) {
    if( fs.existsSync(path) ) {
        fs.readdirSync(path).forEach(function(file) {
          var curPath = path + "/" + file;
            if(fs.lstatSync(curPath).isDirectory()) { // recurse
                deleteFolderRecursive(curPath);
            } else { // delete file
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(path);
      }
  };

function getUrl(hostConsumo) {
    const URL_PROD = 'https://us-central1-suitebrains-produccion.cloudfunctions.net';
    const URL_DESA_PR = 'https://us-central1-siutebrainsprueba.cloudfunctions.net';
    let url = hostConsumo == 'localhost:8080' || hostConsumo == 'siutebrainsprueba.web.app' ? URL_DESA_PR : URL_PROD;
    return url;
}

function getAxiosLib(url, idToken) {
    return axios.create({
        baseURL: url,
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Authorization": "Bearer " + idToken
        }
    });
}

async function clearSesion(idOrganizacion, response) {
    if (global.clientesWs[idOrganizacion]) {
        try {
            await global.clientesWs[idOrganizacion].logout();
        } catch (error) {
            // console.error(new Date() + ' - Error haciendo logout para la organizacion' + idOrganizacion, error);
        }

        try {
            await global.clientesWs[idOrganizacion].destroy();
        } catch (error) {
            // console.error(new Date() + ' - Error haciendo destroy para la organizacion' + idOrganizacion, error);
        }
        
        global.clientesWs[idOrganizacion] = null;

        try {
            // Eliminamos la sesion almacenada en disco asociada a la organizacion.
            fs.unlinkSync(SESSIONES_PATH + idOrganizacion);
            deleteFolderRecursive(SESSIONES_PATH + 'session-' + idOrganizacion);

        } catch(err) {
            console.error('Something wrong happened removing the file', err)
        }

        if (response) {
            try {
                response.send(true);
            } catch (error) {
                response.send(false);
            }
        }
        
    } else {
        if (response) {
            response.send(false);
        }
    }
}

app.get(AMBIENTE + 'ws/existSesion', async (request, response) => {
    let idOrganizacion = request.query.idOrganizacion;
    // await validarToken(request, response);
    let clientWs = global.clientesWs[idOrganizacion];

    let rta = {
        base64QrCodeWs: clientWs ? clientWs.base64QrCodeWs : null,
        sesionWhatsAppIniciada: false
    }

    if (clientWs && clientWs.ready) {
        rta.sesionWhatsAppIniciada = true;

    }

    response.json(rta);

});  

app.get(AMBIENTE + 'ws/clearSesion', async (request, response) => {
    // await validarToken(request, response);
    let idOrganizacion = request.query.idOrganizacion;
    clearSesion(idOrganizacion, response);
});  

app.get(AMBIENTE + 'ws/init', async (request, response) => {
    // await validarToken(request, response);
    let idOrganizacion = request.query.idOrganizacion;
    let idToken = request.headers.authorization?.split('Bearer ')[1];

    if (!global.clientesWs[idOrganizacion]) {
        let infoInit = {
            session: null,
            idOrganizacion: idOrganizacion,
            hostConsumo: request.query.hostConsumo,
            idToken: idToken,
            msgBienvenida: request.query.msgBienvenida,
            horaIni: request.query.horaIni,
            horaFin: request.query.horaFin,
            msgHorario: request.query.msgHorario,
            response: response,
            fecha: new Date()
        }

        initClient(infoInit);

    } else {
        if (!global.clientesWs[idOrganizacion].ready) {
            response.send("Ya existe una sesión iniciada.");
        } else {
            response.send("Ya se inicializo un cliente whatsapp, pero todavia no se a iniciado la sesion.");
        }

    }

});

app.get(AMBIENTE + 'ws/sendMessage', async (request, response) => {
    // await validarToken(request, response);

    try {
        let idOrganizacion = request.query.idOrganizacion;
        let idToken = request.headers.authorization?.split('Bearer ')[1];
        let url = getUrl(request.query.hostConsumo);
        let axiosLib = getAxiosLib(url, idToken);

        if (global.clientesWs[idOrganizacion]) {
            try {
                let infoPersona = {
                    idOrganizacion: idOrganizacion,
                    idPersona: request.query.idPersona,
                    noInactivarMsgAutomaticos: request.query.noInactivarMsgAutomaticos ? true : false
                }

                await axiosLib.post(
                    '/personas-actualizarInfoMensajeria',
                    infoPersona
                );
            } catch (error) {
                console.error(new Date() + ' - Se presento un error tratando de actualizar la fecha de bloqueo de mensajes al enviar un mensaje - (ws/sendMessage)', error);
            }

            let number = request.query.number;
            let text = request.query.text;
            const chatId = number.substring(1) + "@c.us";
            let message = await global.clientesWs[idOrganizacion].sendMessage(chatId, text);
            response.send(message.id);

        } else {
            response.send(false);
        }

    } catch (error) {
        console.error(new Date() + ' - Se presento un error tratando de enviar un mensaje - (ws/sendMessage)', error);
        response.send(false);
    }
});

app.post(AMBIENTE + 'ws/sendMessageMedia', async (request, response) => {
    // await validarToken(request, response);
    try {
        
        let idOrganizacion = request.body.idOrganizacion;
        let idToken = request.headers.authorization?.split('Bearer ')[1];
        let url = getUrl(request.body.hostConsumo);
        let axiosLib = getAxiosLib(url, idToken);

        if (global.clientesWs[idOrganizacion]) {
            try {
                let infoPersona = {
                    idOrganizacion: idOrganizacion,
                    idPersona: request.body.idPersona
                }
    
                await axiosLib.post(
                    '/personas-actualizarInfoMensajeria',
                    infoPersona
                );
            } catch (error) {
                console.error(new Date() + ' - Se presento un error tratando de actualizar la fecha de bloqueo de mensajes al enviar un mensaje - (ws/sendMessageMedia)', error);

            }
            

            // Number where you want to send the message.
            let number = request.body.number;
    
            // Getting chatId from the number.
            // we have to delete "+" from the beginning and add "@c.us" at the end of the number.
            const chatId = number.substring(1) + "@c.us";

            // Your message.
            // let image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAApgAAAKYB3X3/OAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAANCSURBVEiJtZZPbBtFFMZ/M7ubXdtdb1xSFyeilBapySVU8h8OoFaooFSqiihIVIpQBKci6KEg9Q6H9kovIHoCIVQJJCKE1ENFjnAgcaSGC6rEnxBwA04Tx43t2FnvDAfjkNibxgHxnWb2e/u992bee7tCa00YFsffekFY+nUzFtjW0LrvjRXrCDIAaPLlW0nHL0SsZtVoaF98mLrx3pdhOqLtYPHChahZcYYO7KvPFxvRl5XPp1sN3adWiD1ZAqD6XYK1b/dvE5IWryTt2udLFedwc1+9kLp+vbbpoDh+6TklxBeAi9TL0taeWpdmZzQDry0AcO+jQ12RyohqqoYoo8RDwJrU+qXkjWtfi8Xxt58BdQuwQs9qC/afLwCw8tnQbqYAPsgxE1S6F3EAIXux2oQFKm0ihMsOF71dHYx+f3NND68ghCu1YIoePPQN1pGRABkJ6Bus96CutRZMydTl+TvuiRW1m3n0eDl0vRPcEysqdXn+jsQPsrHMquGeXEaY4Yk4wxWcY5V/9scqOMOVUFthatyTy8QyqwZ+kDURKoMWxNKr2EeqVKcTNOajqKoBgOE28U4tdQl5p5bwCw7BWquaZSzAPlwjlithJtp3pTImSqQRrb2Z8PHGigD4RZuNX6JYj6wj7O4TFLbCO/Mn/m8R+h6rYSUb3ekokRY6f/YukArN979jcW+V/S8g0eT/N3VN3kTqWbQ428m9/8k0P/1aIhF36PccEl6EhOcAUCrXKZXXWS3XKd2vc/TRBG9O5ELC17MmWubD2nKhUKZa26Ba2+D3P+4/MNCFwg59oWVeYhkzgN/JDR8deKBoD7Y+ljEjGZ0sosXVTvbc6RHirr2reNy1OXd6pJsQ+gqjk8VWFYmHrwBzW/n+uMPFiRwHB2I7ih8ciHFxIkd/3Omk5tCDV1t+2nNu5sxxpDFNx+huNhVT3/zMDz8usXC3ddaHBj1GHj/As08fwTS7Kt1HBTmyN29vdwAw+/wbwLVOJ3uAD1wi/dUH7Qei66PfyuRj4Ik9is+hglfbkbfR3cnZm7chlUWLdwmprtCohX4HUtlOcQjLYCu+fzGJH2QRKvP3UNz8bWk1qMxjGTOMThZ3kvgLI5AzFfo379UAAAAASUVORK5CYII=";
            let msgMedia = new MessageMedia(request.body.type, request.body.imgBase64, request.body.name);
    
            // let msgMedia = await MessageMedia.fromUrl('https://via.placeholder.com/350x150.png');
            // console.log(msgMedia);
            // Sending message.
        
            let message = await global.clientesWs[idOrganizacion].sendMessage(chatId, msgMedia);
            almacenarArchivo(message, idOrganizacion, request.body.idPersona);
            response.send(message.id);

        } else {
            response.send(false);
        }

    } catch (error) {
        console.error(new Date() + ' - Se presento un error tratando de enviar un mensaje media- (ws/sendMessageMedia)', error);
        response.send(false);
    }
});

app.post(AMBIENTE + 'ws/downloadMedia', async (request, response) => {
    // await validarToken(request, response);

    try {
        
        let idOrganizacion = request.body.idOrganizacion;

        if (global.clientesWs[idOrganizacion]) {

            // Number where you want to send the message.
            let number = request.body.number;
    
            // Getting chatId from the number.
            // we have to delete "+" from the beginning and add "@c.us" at the end of the number.
            const chatId = number.substring(1) + "@c.us";
            let imgBase64;

            try {
                let chat = await global.clientesWs[idOrganizacion].getChatById(chatId);
                let listMessages = await chat.fetchMessages();
                let mensaje = listMessages.find(element => element.id.id == request.body.id);
                let msgMedia;
                
                if (mensaje && mensaje.hasMedia) {
                    msgMedia = await mensaje.downloadMedia();
                    imgBase64 = "data:" + msgMedia.mimetype + ";base64," + msgMedia.data;
                    almacenarArchivoSiNoExiste(mensaje, idOrganizacion, request.body.idPersona, msgMedia);

                } else {
                    imgBase64 = getMessageMedia(idOrganizacion, request.body.idPersona, request.body.id);

                }
            } catch (error) {
                imgBase64 = getMessageMedia(idOrganizacion, request.body.idPersona, request.body.id);
            }

            response.send(imgBase64);

        } else {
            response.send(false);
        }

    } catch (error) {
        console.error(new Date() + ' - Se presento un error tratando de descargar un mensaje- (ws/downloadMedia)', error);
        response.send(false);
    }
});

app.post(AMBIENTE + 'ws/deleteMessage', async (request, response) => {
    // await validarToken(request, response);

    try {
        
        let idOrganizacion = request.body.idOrganizacion;

        if (global.clientesWs[idOrganizacion]) {

            // Number where you want to send the message.
            let number = request.body.number;
    
            // Getting chatId from the number.
            // we have to delete "+" from the beginning and add "@c.us" at the end of the number.
            const chatId = number.substring(1) + "@c.us";

            let chat = await global.clientesWs[idOrganizacion].getChatById(chatId);
            let listMessages = await chat.fetchMessages();
            let mensaje = listMessages.find(element => element.id.id == request.body.id);
            
            if (mensaje) {
                await mensaje.delete(true);
                response.send(true);
            } else {
                listMessages = await chat.fetchMessages({limit:Number.MAX_VALUE});
                mensaje = listMessages.find(element => element.id.id == request.body.id);

                if (mensaje) {
                    await mensaje.delete(true);
                    response.send(true);
                } else {
                    response.send(false);
                }
            }

        } else {
            response.send(false);
        }

    } catch (error) {
        console.error(new Date() + ' - Se presento un error tratando de eliminar un mensaje- (ws/deleteMessage)', error);
        response.send(false);
    }
});

function almacenarArchivoSiNoExiste(message, idOrganizacion, idPersona, msgMediaParam) {
    try {
        let pathArchivos = ARCHIVOS_PATH + idOrganizacion + "/" + idPersona + "/" + message.id.id;
        if(!fs.existsSync(pathArchivos)) {
            almacenarArchivo(message, idOrganizacion, idPersona, msgMediaParam);
        }
    } catch (error) {
        console.error(new Date() + ' - Se presento un error tratando de almacenar el archivo- (ws/downloadMedia - almacenarArchivoSiNoExiste)', error);
    }
    
}

app.listen(PUERTO);
console.log('Server on port: ', PUERTO)