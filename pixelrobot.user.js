// ==UserScript==
// @name        Pixel Robot
// @namespace   http://github.com/mingyizhao/pixelrobot
// @description Draw points semiautomatically.
// @run-at      document-start
// @include     https://pxls.space/*
// @include     http://pxls.space/*
// @downloadURL https://github.com/mingyizhao/pixelrobot/raw/master/pixelrobot.user.js
// @version     0.2.8
// @grant       GM_notification
// ==/UserScript==


(function(){
//----------------------------------------------------------------------------
// Run as early as possible

var mySend = function(){},
    wsInterceptSuccess = false;

WebSocket.prototype.send = (function(oldfunc){
    return function(m){
        if(true === mySend(m)){
            oldfunc.call(this, m);
            console.debug("SENT", m);
        } else {
            console.warn("CENSORED", m);
        }
    }
})(WebSocket.prototype.send);

if(undefined === unsafeWindow.App){
    wsInterceptSuccess = true;
}

function notify(m) {
    try{
        GM_notification(m, "Pixel Robot");
    }catch(e){
        console.info(m);
    }
}


var main = function(){
//----------------------------------------------------------------------------

var L, T, R, B, W, H;
var canvasLoaded = false;
var templateSize = 1, canvasDifferences = 0;
var templateIndexed = null;

var waitCaptcha = false, power = false;
var cooldown = 0, period = 1000;
var attentionAlert = 15;

var pixelPendingTimeout = 30000;

var stat = {
    count: 0,
    progress: [],
    eta: null,
}

// ---------------------------------------------------------------------------
// Namespace Generation

var NAMESPACE = ''
function randchars(count){
    var alphabet = "abcdefghijklmnopqrstuvwxyz", amax = alphabet.length;
    var ret = '';
    for(var i=0; i<count; i++){
        ret += alphabet[Math.floor(Math.random() * amax)];
    }
    return ret;
}
NAMESPACE = randchars(5) + '-' + randchars(9);
var me = '.' + NAMESPACE;

// ---------------------------------------------------------------------------
// Statistics

function statReset(){
    stat.count = 0;
    stat.progress = [];
    stat.eta = null;
}

function statCountPoint(){
    stat.count += 1;
}

function statRecordProgress(remaining){
    var now = (new Date()).getTime();
    stat.progress.push([now, remaining]);
    statCalcETA();
}

function statCalcETA(){
    var p = stat.progress, max = 10, i=0, diff = [];
    var sum=0, sumT=0, speed=0, dt=0, remaining=0;
    if(p.length < 2){
        return (stat.eta = null);
    }
    while(p.length > max) p.shift();

    for(i=0; i<p.length-1; i++){
        dt = (p[i+1][0] - p[i][0]) / 60000.0;
        speed = (p[i+1][1] - p[i][1])/dt;
        if(isNaN(speed)) continue;
        diff.push([speed, dt]);
    }
    for(i=0; i<diff.length; i++){
        sum += diff[i][0] * diff[i][1];  // integral(v*dt)
        sumT += diff[i][1];              // integral(dt)=T
    }
    speed = sum / sumT;  // how many points per minute
    remaining = p[p.length-1][1];
    if(speed >= 0 || remaining < 1){
        // points remaining is increasing, cannot say.
        // or job already finished
        return (stat.eta = null);
    }
    stat.eta = (
        (new Date()).getTime() + (remaining / Math.abs(speed) * 60000));
    console.debug("ETA recalculated:", stat.eta, "speed:", speed, "points/min");
    return stat.eta;
}


// ---------------------------------------------------------------------------
// User Interface

var info = GM_info.script;

var ui = [
'<style>',
'.pixelrobot{',
    'font-size: 0.8em;',
    'padding:2px;background:#000099;color:#FFFFFF;border-color:#00CCFF;',
'}',
'.pixelrobot button{',
    'background:#3333CC;color:#FFFFFF;',
    'border-width:1px; border-color:#00CCFF; border-style: solid;',
    'width: 100%;',
    'margin:2px;padding:2px',
'}',
'.pixelrobot button.active{',
    'background:#FFFFFF;color:#3333CC;',
'}',
'.pixelrobot input{width: 5em;}',
'</style>',
'<div class="pixelrobot"',
'style="',
    'position: absolute; right:0; top: 0; z-index:9999;',
'">',
'<strong>PSPC: Pxls Space Partial Conversion</strong><br />',
'<div name="scriptinfo">',
('Version: ' + info.version),
'</div>',
'<hr />',
'<img name="template" style="display: none"/>',
'<table style="border:none">',
    '<tr><td>Template:</td><td colspan="2"><input class="input" type="file" /></td></tr>',
    '<tr><td /><td><input class="input" type="text" name="T" placeholder="T" value="0" /></td><td /></tr>',
    '<tr>',
        '<td><input class="input" type="text" name="L" value="0" placeholder="L" /></td>',
        '<td><canvas name="template" style="width:150px; height:150px;"></canvas></td>',
        '<td><input type="text" name="R" placeholder="R" disabled/></td>',
    '</tr>',
    '<tr><td /><td><input type="text" name="B" placeholder="B" disabled/></td><td /></tr>',
    '<tr><td>Progress:</td><td colspan="2" name="progress" /></tr>',
    '<tr><td>Cooldown:</td><td colspan="2" name="cooldown" /></tr>',
    '<tr><td>Count:</td><td colspan="2" name="count" /></tr>',
    '<tr><td>ETA:</td><td colspan="2" name="eta" /></tr>',
'</table>',
'<div><button name="manual">Test/Force Paint Manually</button></div>',
'<div><button name="startstop">Click to start robot.</button></div>',
'</div>',
].join("").replace(/pixelrobot/g, NAMESPACE);
$(ui).appendTo('body');

function loadTemplate(){
    var preview = $(me).find('img[name="template"]')[0];
    var file = $(me).find('input[type=file]')[0].files[0];
    var reader = new FileReader();

    console.log("Load image...");

    function continuePreview(){
        W = preview.width;
        H = preview.height;
        console.log("Load image: width=", W, ", height=", H);

        var canvas = $(me).find('canvas[name="template"]')[0];
        canvas.width = W;
        canvas.height = H;
        canvas.getContext('2d').drawImage(preview, 0, 0, W, H);

        canvasLoaded = true;
        templateIndexed = null;
    }

    reader.onloadend = function () {
        preview.src = reader.result;
        preview.onload = continuePreview;
    }
    if (file) {
        reader.readAsDataURL(file);
    } else {
        preview.src = "";
    }
}

function assureSystemInited(){
    if(!canvasLoaded){
        notify("Error: Load your image first!");
        return false;
    }
    try{
        L = parseInt($(me).find('input[name="L"]').val());
        T = parseInt($(me).find('input[name="T"]').val());
        R = L + W - 1;
        B = T + H - 1;
        if(!(
            L < R && T < B &&
            L >= 0 && T >= 0 &&
            R < 2000 && B < 2000
        )) throw Error("Invalid boundings.");
        console.log("Boundings, L,T,R,B=",L,T,R,B);
    } catch(e){
        notify("Error: Invalid boundings(L/R/T/B), check it!");
        console.error(e, L, T, R, B);
        return false;
    }
    $(me).find('input[name="R"]').val(R);
    $(me).find('input[name="B"]').val(B);
    statReset();
    return true;
}


$(me).find('button[name="startstop"]').click(powerSwitch);

$(me).find('input[type="file"]').on('change', loadTemplate);

$(me).find('button[name="manual"]').click(function(){
    if(!assureSystemInited()) return;
    forcePaintPoint();
});


function powerSwitch(force){
    if(true === force || false === force){
        power = force;
    } else {
        power = !power;
    }
    if(power){
        if(!assureSystemInited()) return;
        $(me).find('button[name="startstop"]').text("RUNNING...Click to stop robot.");
        $(me).find('table input.input').attr('disabled', true);
    } else {
        $(me).find('button[name="startstop"]').text("Click to start robot.");
        $(me).find('table input.input').attr('disabled', false);
    }
}

function updateUI(){
    $(me).find('[name="progress"]').text(
        ((1 - canvasDifferences / templateSize) * 100.0).toString().slice(0,5) +
        " %, " +
        canvasDifferences +
        " remaining"
    );

    var cooldownDiff = cooldown - (new Date).getTime();
    if(cooldownDiff > 0){
        $(me).find('[name="cooldown"]').text(
            Math.round( cooldownDiff / 1000.0 ).toString() + " sec"
        );
    } else {
        $(me).find('[name="cooldown"]').text("None");
    }

    if(power){
        $(me).find('[name="startstop"]').toggleClass('active');
    } else {
        $(me).find('[name="startstop"]').removeClass('active');
    }

    $(me).find('[name="count"]').text(stat.count + " point(s) done.");
    $(me).find('[name="eta"]').text((
        (null !== stat.eta) ? 
        (new Date(stat.eta)).toLocaleString() :
        'Unknown'
    ));
}


//----------------------------------------------------------------------------
// Color and Image Data Management

var palette = [
    [255, 255, 255],
    [228, 228, 228],
    [136, 136, 136],
    [34, 34, 34],
    [255, 167, 209],
    [229, 0, 0],
    [229, 149, 0],
    [160, 106, 66],
    [229, 217, 0],
    [148, 224, 68],
    [2, 190, 1],
    [0, 211, 221],
    [0, 131, 199],
    [0, 0, 234],
    [207,110,228],
    [130,0,128],
];

// Color Index Converter
// value: [0, 15] --- valid color index
//            254 --- transparent
//            255 --- undecided(not calculated)

var colorIndexCache = [];
for(var i=0; i<256; i++){
    var s = [];
    for(var j=0; j<256; j++){
        var u = new Uint8Array(256);
        u.fill(255);
        s.push(u);
    }
    colorIndexCache.push(s);
}
function getColorIndex(rgba, ackTransparency){
    if(ackTransparency && rgba[3] < 128) return 254;
    if(255 != colorIndexCache[rgba[0]][rgba[1]][rgba[2]]){
        return colorIndexCache[rgba[0]][rgba[1]][rgba[2]];
    }
    var compares = [], min = 9999999, sq = 0;
    for(var i=0; i<palette.length; i++){
        sq =(
            Math.pow(rgba[0] - palette[i][0], 2) +
            Math.pow(rgba[1] - palette[i][1], 2) +
            Math.pow(rgba[2] - palette[i][2], 2)
        );
        compares.push(sq);
        if(sq < min) min = sq;
    }
    for(var i=0; i<compares.length; i++){
        if(compares[i] == min) break;
    }
    colorIndexCache[rgba[0]][rgba[1]][rgba[2]] = i;
    return i;
}

function rgba2Index(rgbaArray, ackTransparency){
    var i = 0, j=0, imax = rgbaArray.length - 1;
    var olen = rgbaArray.length / 4;
    var output = new Uint8Array(olen);
    while(i <= imax){
        output[j] = getColorIndex(rgbaArray.slice(i, i+4), ackTransparency);
        i += 4;
        j += 1;
    }
    return output;
}

// Image RGBA Data to Indexed Data Converter

function readTemplateIndexed(){
    if(templateIndexed) return templateIndexed;
    // nx: 0...1, ny: 0...1
    var canvas = $(me).find('canvas[name="template"]')[0];
    var d = canvas.getContext('2d').getImageData(0, 0, W, H).data;
    templateIndexed = rgba2Index(d, true);
    templateSize = templateIndexed.length;
    return templateIndexed;
}

function readCanvasIndexed(){
    var canvas = unsafeWindow.App.elements.board[0];
    var d = canvas.getContext('2d').getImageData(L, T, W, H).data;
    return rgba2Index(d, false);
}

// Canvas and Template Comparer

function compareCanvasToTemplate(){
    var source = readTemplateIndexed(),
        target = readCanvasIndexed();
    var diffArray = new Uint8Array(target.length);
    canvasDifferences = 0;
    for(var i=0; i<diffArray.length; i++){
        if(source[i] == target[i] || source[i] == 254){
            diffArray[i] = 0;
        } else {
            diffArray[i] = 1;
            canvasDifferences += 1;
        }
    }
    statRecordProgress(canvasDifferences);
    return diffArray;
}

function pickOneDifferencePointRandomly(){
    var diffArray = compareCanvasToTemplate();
    if(canvasDifferences < 1) return null;
    
    var indexes = new Uint32Array(canvasDifferences);
    var i=0, j=0, pickIndex, dx, dy;
    for(var i=0; i<diffArray.length; i++){
        if(diffArray[i]){
            indexes[j] = i;
            j += 1;
        }
    }
    pickIndex = indexes[Math.floor(Math.random() * canvasDifferences)];
    dx = pickIndex % W;
    dy = Math.floor(pickIndex / W);

    return {
        sx: dx,
        sy: dy,
        tx: L + dx,
        ty: T + dy,
        c: readTemplateIndexed()[pickIndex],
    }
}



// ---------------------------------------------------------------------------
// Semiautomatic Drawing Controller

function lockCooldown(seconds){
    cooldown = (new Date).getTime() + seconds * 1000;
}

function heartbeat(){
    updateUI();
    if(!power) return;
    if(waitCaptcha) return;
    var now = (new Date).getTime();
    if(now <= cooldown) return;
    paintPoint();
}
setInterval(heartbeat, period);

function captchaReminder(){
    if(waitCaptcha){
        notify("Pxls.space needs your interaction!");
    }
}
setInterval(captchaReminder, attentionAlert * period);





// ---- Websocket Interceptor

mySend = function mySend(m){
    // censor the traffic to server
    var l = [
        "placepixel", "captcha", 
    ];
    m = JSON.parse(m);
    if(l.indexOf(m.type.toLowerCase()) < 0){
        notify("WARNING! System is doing suspicious thing. Please report this to author. For your safety robot will stop.");
        console.warn("WARNING: Report followings to author:");
        console.warn(m);
        powerSwitch(false); // stop robot
        return false;
    }
    return true;
}

function myOnMessage(m){
    m = JSON.parse(m.data);

    if("captcha_required" == m.type){
        // pause robot
        console.log("Captcha challenged. Pause!");
        waitCaptcha = true;
        notify("Pxls.space is questioning whether you're a bot or a human. Robot paused. Check it!");
        return;
    }

    if("captcha_status" == m.type){
        // resume robot
        waitCaptcha = false;
        if(m.success){
            console.log("Captcha passed. Continue!");
            notify("Thanks! Captcha passed. Continue job!");
            doPaint();
        } else {
            console.log("Captcha failed.");
            notify("Captcha failed. Do it again. Or refresh page!");
        }
        return;
    }

    if("cooldown" == m.type){
        var dt = m.wait;
        if(dt < 15) dt = 15;
        dt += Math.floor(Math.random() * 10);
        notify("Cooldown active: " + dt + " seconds.");
        lockCooldown(dt);
        markPainted((m.wait > 120));
        return;
    }
}
unsafeWindow.App.socket.onmessage = (function(oldfunc){
    return function(m){
        if(false !== myOnMessage(m)){
            oldfunc(m);
        }
    }
})(unsafeWindow.App.socket.onmessage);




// ---- point painter

var pendingPixel = null, lastPendingPixelTime = 0;

function doPaint(){
    if(null === pendingPixel) return;
    //unsafeWindow.App.switchColor(color);
    //unsafeWindow.App.doPlace(x, y);
    
    unsafeWindow.App.socket.send(
        JSON.stringify({
            type: "placepixel",
            x: pendingPixel.tx,
            y: pendingPixel.ty,
            color: pendingPixel.c,
        })
    );
    
    console.log(
        "Paint color ", pendingPixel.c,
        " to (", pendingPixel.tx, ",", pendingPixel.ty, ") from (",
        pendingPixel.sx, ",", pendingPixel.sy, ")."
    );
    lockCooldown(60);
}

function markPainted(confidence){
    pendingPixel = null;
    if(confidence) statCountPoint();
}

function paintPoint(){
    if(
        (null !== pendingPixel) && 
        ((new Date).getTime() - lastPendingPixelTime < pixelPendingTimeout)
    ) return;
    pendingPixel = pickOneDifferencePointRandomly();
    lastPendingPixelTime = (new Date).getTime();
    doPaint();
    return true;
}

function forcePaintPoint(){
    pendingPixel = null;
    paintPoint();
}


notify("Pixel Robot ready. Control panel right top, click to start.");

//----------------------------------------------------------------------------

}; // end of main();


if(wsInterceptSuccess){
    function starter(){
        if(unsafeWindow.jQuery && unsafeWindow.App){
            $(function(){ main(); });
            return;
        } else {
            setTimeout(starter, 500);
        }
    }
    starter();
} else {
    notify("Failed to start Pixelrobot.");
}


})();
