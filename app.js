require('dotenv').config();
const express = require('express');
const app = express();
const session = require('express-session');
const passport = require('passport');
const Strategy = require('passport-discord').Strategy;
const questions = require('./questions');
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// --- تفعيل حماية Helmet ---
app.use(helmet({
    contentSecurityPolicy: false,
}));

// --- إعداد نظام تحديد المعدل (Rate Limiting) لمنع السبام ---
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: '<html dir="rtl"><body style="background:#121212;color:#fff;font-family:sans-serif;text-align:center;padding-top:50px;"><h2 style="color:#d97706;">⚠️ لقد تجاوزت الحد المسموح من الطلبات، يرجى المحاولة لاحقاً.</h2></body></html>'
});

app.use(limiter);

const authLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 10,
    message: '⚠️ محاولات كثيرة جداً، يرجى الانتظار قليلاً.'
});
app.use('/submit-activation', authLimiter);
app.use('/submit-application', authLimiter);
app.use('/submit-receipt', authLimiter);

const upload = multer({ dest: 'uploads/' });

const WEBHOOK_URL = 'https://discord.com/api/webhooks/1531421743531426024/U8CUMck1LZEXE-t_QmPFw0PNlJxfzOlhxQhwdc-BlRefd7IpcQcKJVqpNaGsxKLCFFYs';

// --- نظام حفظ الحظر ---
const DATA_FILE = './blockedUsers.json';
let blockedUsers = {};
if (fs.existsSync(DATA_FILE)) {
    try { blockedUsers = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { blockedUsers = {}; }
}
function saveBlockedUsers() { fs.writeFileSync(DATA_FILE, JSON.stringify(blockedUsers, null, 2)); }

// --- نظام منع تكرار تقديم الدعم الفني ---
const SUPPORT_APPLICANTS_FILE = './supportApplicants.json';
let supportApplicants = {};
if (fs.existsSync(SUPPORT_APPLICANTS_FILE)) {
    try { supportApplicants = JSON.parse(fs.readFileSync(SUPPORT_APPLICANTS_FILE, 'utf8')); } catch (e) { supportApplicants = {}; }
}
function saveSupportApplicants() { fs.writeFileSync(SUPPORT_APPLICANTS_FILE, JSON.stringify(supportApplicants, null, 2)); }

const NEWS_FILE = './news.json';
const STORE_FILE = './storeProducts.json';
const APPS_CONFIG_FILE = './applicationsList.json';
const SUBMISSIONS_FILE = './applicationsSubmissions.json';
const ACTIVATION_SUBMISSIONS_FILE = './activationSubmissions.json';

const APPLICANTS_FILE = './applicants.json';
let totalApplicants = 0;
if (fs.existsSync(APPLICANTS_FILE)) {
    try { totalApplicants = JSON.parse(fs.readFileSync(APPLICANTS_FILE, 'utf8')).count || 0; } catch (e) { totalApplicants = 0; }
}
function updateApplicantsCount() {
    totalApplicants++;
    fs.writeFileSync(APPLICANTS_FILE, JSON.stringify({ count: totalApplicants }, null, 2));
}

// --- إعدادات الديسكورد الأساسية ---
const CLIENT_ID = '1527376983066017822';
const CLIENT_SECRET = 'weFyNFI42oTNKfIAG-jWKxw--3YACawt';
// تم ضبط الرابط تلقائياً ليتوافق مع ريندر أو الـ Localhost
const REDIRECT_URI = process.env.RENDER_EXTERNAL_URL 
    ? `${process.env.RENDER_EXTERNAL_URL}/auth/discord/callback` 
    : 'https://server-bdw.onrender.com/auth/discord/callback';

const GUILD_ID = '1524892193486274720';
const ADMIN_ROLE_ID = '1529562743307374622';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences
    ]
});
client.login(process.env.BOT_TOKEN);

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --- إعداد الجلسة (Session) المحدث والآمن ---
app.use(session({
    secret: process.env.SESSION_SECRET || 'secret-key-123',
    resave: false,
    saveUninitialized: false,
    proxy: true, // مهم جداً ويعتبر ضروري لتطبيقات Render خلف الـ Proxy
    cookie: { 
        secure: process.env.NODE_ENV === 'production', // تفعيل الحماية لو كان على سرفر حي
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // تنتهي الجلسة بعد 24 ساعة
    }
}));

app.use(passport.initialize());
app.use(passport.session());

// --- ربط استراتيجية الديسكورد المحدثة ---
passport.use(new Strategy({
    clientID: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    callbackURL: REDIRECT_URI,
    scope: ['identify', 'guilds']
}, async (accessToken, refreshToken, profile, done) => {
    try {
        return done(null, profile);
    } catch (error) {
        return done(error, null);
    }
}));

passport.serializeUser((user, done) => { done(null, user); });
passport.deserializeUser((obj, done) => { done(null, obj); });

// --- معالج الأخطاء العام ---
app.use((err, req, res, next) => {
    console.error("❌ الخطأ الداخلي المفصل:", err);
    const errorMsg = err.stack || err.message || JSON.stringify(err, Object.getOwnPropertyNames(err));
    res.status(500).send(`
        <html dir="rtl">
        <head><meta charset="UTF-8"><title>خطأ في المصادقة</title></head>
        <body style="background: #121212; color: #fff; font-family: sans-serif; padding: 40px; text-align: center;">
            <h2 style="color: #d97706;">تفاصيل الخطأ البرمجي:</h2>
            <pre style="background: #1e1e1e; padding: 20px; border-radius: 8px; border: 1px solid #d97706; text-align: left; display: inline-block; max-width: 800px; white-space: pre-wrap;" dir="ltr">${errorMsg}</pre>
            <br><br>
            <a href="/" style="background: #d97706; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 5px;">العودة للرئيسية</a>
        </body>
        </html>
    `);
});

function checkAuth(req, res, next) {
    if (req.isAuthenticated()) return next();
    req.session.returnTo = req.originalUrl;
    res.redirect('/login');
}

async function checkAdmin(req, res, next) {
    if (!req.isAuthenticated()) {
        req.session.returnTo = req.originalUrl;
        return res.redirect('/login');
    }
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(req.user.id);
        if (member.roles.cache.has(ADMIN_ROLE_ID)) {
            return next();
        }
        res.status(403).send("🚫 غير مسموح لك بالدخول: هذه الصفحة خاصة بمشرفي الموقع فقط.");
    } catch (error) {
        console.error("خطأ في التحقق من صلاحيات المشرف:", error.message);
        res.status(500).send("حدث خطأ أثناء التحقق من الصلاحيات.");
    }
}

// --- المسارات الرئيسية ---
app.get('/', async (req, res) => {
    try {
        const guild = client.guilds.cache.get(GUILD_ID) || await client.guilds.fetch(GUILD_ID).catch(() => null);
        let stats = { totalMembers: 0, onlineMembers: 0, applicantsCount: totalApplicants };
        let isAdmin = false;

        if (guild) {
            stats.totalMembers = guild.memberCount;
            
            stats.onlineMembers = guild.members.cache.filter(member =>
                member.presence && member.presence.status !== 'offline'
            ).size;

            if (req.user) {
                try {
                    const member = await guild.members.fetch(req.user.id);
                    if (member.roles.cache.has(ADMIN_ROLE_ID)) {
                        isAdmin = true;
                    }
                } catch (err) {
                    console.log("تنبيه: لم يتم العثور على العضو داخل السيرفر.");
                }
            }
        }
        res.render('index', { user: req.user, stats: stats, isAdmin: isAdmin });
    } catch (error) {
        console.error("خطأ في جلب بيانات السيرفر:", error.message);
        res.render('index', { user: req.user, stats: { totalMembers: 0, onlineMembers: 0, applicantsCount: totalApplicants }, isAdmin: false });
    }
});

app.get('/login', passport.authenticate('discord'));

app.get('/auth/discord/callback',
    passport.authenticate('discord', { failureRedirect: '/' }),
    (req, res) => {
        const redirectTo = req.session.returnTo || '/';
        delete req.session.returnTo;
        res.redirect(redirectTo);
    }
);

app.get('/rules', (req, res) => res.render('rules'));

app.get('/store', (req, res) => {
    let storeProducts = [];
    if (fs.existsSync(STORE_FILE)) {
        try {
            storeProducts = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
            if (!Array.isArray(storeProducts)) storeProducts = [];
        } catch (e) { storeProducts = []; }
    }
    res.render('store', { products: storeProducts, user: req.user });
});

app.get('/checkout', checkAuth, (req, res) => {
    res.render('checkout', { user: req.user });
});

app.post('/process-checkout', checkAuth, (req, res) => {
    const { realName, discordUser, gameId, phone, cartItems, totalPrice } = req.body;
    
    req.session.orderData = {
        realName,
        discordUser,
        gameId,
        phone,
        cartItems: typeof cartItems === 'string' ? JSON.parse(cartItems) : cartItems,
        totalPrice,
        date: new Date().toLocaleString('ar-SA')
    };

    res.redirect('/payment');
});

app.get('/payment', checkAuth, (req, res) => {
    const orderData = req.session.orderData;
    if (!orderData) return res.redirect('/store');

    const bankInfo = {
        name: "زياد مسفر سعد الجبيري",
        accountNumber: "461000010006086239313",
        iban: "SA06 8000 0461 6080 1623 9313",
        swift: "RJHISARI"
    };

    res.render('payment', { user: req.user, orderData, bankInfo });
});

app.post('/submit-receipt', checkAuth, upload.single('receiptImage'), async (req, res) => {
    try {
        const receiptFile = req.file;
        
        if (!receiptFile) {
            return res.status(400).send('الرجاء إرفاق صورة الإيصال.');
        }

        const orderData = req.session.orderData || {};
        let itemsListText = '';
        if (Array.isArray(orderData.cartItems)) {
            itemsListText = orderData.cartItems.map(item => `• ${item.name} (**${item.price} ر.س**)`).join('\n');
        }

        const formData = new FormData();
        
        const embedPayload = {
            embeds: [
                {
                    title: "🚨 طلب متجر جديد بانتظار المراجعة",
                    description: "تم رفع إيصال تحويل جديد من أحد اللاعبين، يرجى مراجعته واعتماده.",
                    color: 14238214,
                    fields: [
                        { name: "👤 الاسم الحقيقي", value: orderData.realName || 'غير متوفر', inline: true },
                        { name: "💬 يوزر الديسكورد", value: orderData.discordUser || req.user.username, inline: true },
                        { name: "🆔 آيدي اللعبة", value: orderData.gameId || 'غير متوفر', inline: true },
                        { name: "📱 رقم الجوال", value: orderData.phone || 'غير متوفر', inline: true },
                        { name: "💰 الإجمالي", value: `**${orderData.totalPrice || 0} ر.س**`, inline: true },
                        { name: "📦 المنتجات المطلوبة", value: itemsListText || 'لا توجد منتجات محددة', inline: false }
                    ],
                    image: {
                        url: `attachment://${receiptFile.originalname}`
                    },
                    timestamp: new Date().toISOString(),
                    footer: {
                        text: "سيرفر البادية RP • نظام المتجر الإلكتروني"
                    }
                }
            ]
        };

        formData.append('payload_json', JSON.stringify(embedPayload));
        
        const blob = new Blob([fs.readFileSync(receiptFile.path)]);
        formData.append('file', blob, receiptFile.originalname);

        const discordResponse = await fetch(WEBHOOK_URL, {
            method: 'POST',
            body: formData
        });

        fs.unlinkSync(receiptFile.path);

        if (!discordResponse.ok) {
            throw new Error('فشل إرسال الإيصال إلى ويب هوك ديسكورد.');
        }
        
        delete req.session.orderData;
        
        res.render('payment-success', { user: req.user });
    } catch (error) {
        console.error("خطأ في إرسال الإيصال عبر الويب هوك:", error);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).send('حدث خطأ أثناء إرسال الإيصال.');
    }
});

app.get('/contact', checkAuth, (req, res) => res.render('contact', { user: req.user }));
app.get('/constitution', (req, res) => res.render('constitution', { user: req.user }));

app.get('/news', (req, res) => {
    let newsList = [];
    if (fs.existsSync(NEWS_FILE)) {
        try {
            newsList = JSON.parse(fs.readFileSync(NEWS_FILE, 'utf8'));
            if (!Array.isArray(newsList)) newsList = [];
        } catch (e) { newsList = []; }
    }
    res.render('news', { newsList, user: req.user });
});

app.get('/apply-activation', checkAuth, (req, res) => {
    res.render('apply', { appDetails: { title: "تقديم التفعيل (القوانين والسيناريو)" }, questions: questions, message: null, isSuccess: false, user: req.user });
});

app.post('/submit-activation', checkAuth, (req, res) => {
    const { ...answers } = req.body;
   
    let formattedAnswers = {};
    Object.keys(answers).forEach((key) => {
        if (key.startsWith('q')) {
            const index = parseInt(key.replace('q', ''));
            const qObj = questions[index];
            const qText = qObj ? (typeof qObj === 'string' ? qObj : (qObj.text || `السؤال ${index + 1}`)) : `السؤال ${index + 1}`;
            formattedAnswers[qText] = answers[key];
        } else {
            formattedAnswers[key] = answers[key];
        }
    });

    let activationSubmissions = {};
    if (fs.existsSync(ACTIVATION_SUBMISSIONS_FILE)) {
        try {
            activationSubmissions = JSON.parse(fs.readFileSync(ACTIVATION_SUBMISSIONS_FILE, 'utf8'));
        } catch (e) { activationSubmissions = {}; }
    }
   
    const submissionId = req.user.id + '_' + Date.now();
    activationSubmissions[submissionId] = {
        id: submissionId,
        discordId: req.user.id,
        username: req.user.username || req.user.globalName || 'مستخدم',
        answers: formattedAnswers,
        status: 'قيد الانتظار',
        date: new Date().toLocaleString('ar-SA')
    };
   
    fs.writeFileSync(ACTIVATION_SUBMISSIONS_FILE, JSON.stringify(activationSubmissions, null, 2));
    updateApplicantsCount();
   
    res.render('apply', {
        appDetails: { title: "تقديم التفعيل (القوانين والسيناريو)" },
        questions: questions,
        message: "🎉 تم إرسال تقديم التفعيل بنجاح وسيتم مراجعته من قبل الإدارة قريباً!",
        isSuccess: true,
        user: req.user
    });
});

app.get('/applications', checkAuth, (req, res) => {
    let appsList = [];
    if (fs.existsSync(APPS_CONFIG_FILE)) {
        try {
            const rawData = fs.readFileSync(APPS_CONFIG_FILE, 'utf8');
            const parsedData = JSON.parse(rawData);
            if (Array.isArray(parsedData)) {
                appsList = parsedData;
            } else if (parsedData && typeof parsedData === 'object') {
                appsList = Object.values(parsedData);
            }
        } catch (e) { appsList = []; }
    }
    res.render('applications', { appsList, user: req.user });
});

app.get('/apply/:id', checkAuth, (req, res) => {
    const appId = req.params.id;
    let appsList = [];
    if (fs.existsSync(APPS_CONFIG_FILE)) {
        try {
            const parsedData = JSON.parse(fs.readFileSync(APPS_CONFIG_FILE, 'utf8'));
            if (Array.isArray(parsedData)) appsList = parsedData;
            else if (parsedData && typeof parsedData === 'object') appsList = Object.values(parsedData);
        } catch (e) { appsList = []; }
    }
   
    const appItem = appsList.find(a => a.id == appId);
    if (!appItem) {
        return res.status(404).send('عذراً، هذا التقديم غير موجود أو تم إغلاقه.');
    }
   
    res.render('apply', {
        appDetails: appItem,
        questions: appItem.questions || [],
        message: null,
        isSuccess: false,
        user: req.user
    });
});

app.post('/submit-application', checkAuth, (req, res) => {
    const { appId, ...answers } = req.body;
   
    let appsList = [];
    if (fs.existsSync(APPS_CONFIG_FILE)) {
        try {
            const parsedData = JSON.parse(fs.readFileSync(APPS_CONFIG_FILE, 'utf8'));
            if (Array.isArray(parsedData)) appsList = parsedData;
            else if (parsedData && typeof parsedData === 'object') appsList = Object.values(parsedData);
        } catch (e) { appsList = []; }
    }
   
    const appItem = appsList.find(a => a.id == appId);
    const appTitle = appItem ? appItem.title : 'تقديم عام';
    const appQuestions = appItem ? appItem.questions : [];

    let formattedAnswers = {};
    Object.keys(answers).forEach((key) => {
        if (key.startsWith('q')) {
            const index = parseInt(key.replace('q', ''));
            const qObj = appQuestions[index];
            const qText = qObj ? (typeof qObj === 'string' ? qObj : (qObj.text || `السؤال ${index + 1}`)) : `السؤال ${index + 1}`;
            formattedAnswers[qText] = answers[key];
        } else {
            formattedAnswers[key] = answers[key];
        }
    });

    let submissions = {};
    if (fs.existsSync(SUBMISSIONS_FILE)) {
        try { submissions = JSON.parse(fs.readFileSync(SUBMISSIONS_FILE, 'utf8')); } catch (e) { submissions = {}; }
    }
   
    const submissionId = req.user.id + '_' + Date.now();
    submissions[submissionId] = {
        id: submissionId,
        appId: appId,
        appTitle: appTitle,
        discordId: req.user.id,
        username: req.user.username || req.user.globalName || 'مستخدم',
        answers: formattedAnswers,
        status: 'قيد الانتظار',
        date: new Date().toLocaleString('ar-SA')
    };
   
    fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify(submissions, null, 2));
   
    res.render('apply', {
        appDetails: appItem,
        questions: appQuestions,
        message: "🎉 تم إرسال تقديمك بنجاح وسيتم مراجعته من قبل الإدارة قريباً!",
        isSuccess: true,
        user: req.user
    });
});

app.get('/apply-support', checkAuth, (req, res) => {
    const userId = req.user.id;
    if (supportApplicants[userId]) {
        return res.render('apply-support', {
            questions: [],
            message: "⚠️ لقد قمت بتقديم طلب الدعم الفني مسبقاً ولا يمكنك التقديم مرة أخرى.",
            isSuccess: false,
            user: req.user
        });
    }

    const supportQuestions = [
        { id: 1, text: "الاسم:" },
        { id: 2, text: "العمر:" },
        { id: 3, text: "هل كنت إداري بسيرفر ثاني؟", options: ["نعم", "لا"] },
        { id: 4, text: "ما مدى خبرتك في حل مشاكل FiveM واللعبة؟", options: ["ممتازة", "متوسطة", "مبتدئة"] },
        { id: 5, text: "هل تمتلك سرعة استجابة وتفرغ لمساعدة اللاعبين؟", options: ["نعم بشغف", "أحياناً"] },
        { id: 6, text: "لماذا تريد الانضمام لفريق الدعم الفني بالتحديد؟", options: ["لخدمة المجتمع وتطويره", "تجربة جديدة"] }
    ];
    res.render('apply-support', { questions: supportQuestions, message: null, isSuccess: false, user: req.user });
});

app.post('/submit-support-application', checkAuth, async (req, res) => {
    const userId = req.user.id;
    if (supportApplicants[userId]) {
        return res.render('apply-support', {
            questions: [],
            message: "⚠️ لقد قمت بتقديم طلب الدعم الفني مسبقاً ولا يمكنك التقديم مرة أخرى.",
            isSuccess: false,
            user: req.user
        });
    }

    supportApplicants[userId] = { date: Date.now(), answers: req.body, status: 'قيد الانتظار' };
    saveSupportApplicants();

    return res.render('apply-support', {
        questions: [],
        message: "🎉 تم إرسال طلبك بنجاح! سيتم مراجعته من قبل الإدارة وإعطاؤك الرتبة في حال القبول.",
        isSuccess: true,
        user: req.user
    });
});

app.get('/admin', checkAdmin, (req, res) => {
    let supportApps = fs.existsSync(SUPPORT_APPLICANTS_FILE) ? JSON.parse(fs.readFileSync(SUPPORT_APPLICANTS_FILE, 'utf8')) : {};
   
    let newsList = [];
    if (fs.existsSync(NEWS_FILE)) {
        try { newsList = JSON.parse(fs.readFileSync(NEWS_FILE, 'utf8')); if (!Array.isArray(newsList)) newsList = []; } catch (e) { newsList = []; }
    }

    let storeProducts = [];
    if (fs.existsSync(STORE_FILE)) {
        try { storeProducts = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); if (!Array.isArray(storeProducts)) storeProducts = []; } catch (e) { storeProducts = []; }
    }

    let appsList = [];
    if (fs.existsSync(APPS_CONFIG_FILE)) {
        try {
            const parsedData = JSON.parse(fs.readFileSync(APPS_CONFIG_FILE, 'utf8'));
            if (Array.isArray(parsedData)) appsList = parsedData;
            else if (parsedData && typeof parsedData === 'object') appsList = Object.values(parsedData);
        } catch (e) { appsList = []; }
    }

    let appSubmissions = {};
    if (fs.existsSync(SUBMISSIONS_FILE)) {
        try { appSubmissions = JSON.parse(fs.readFileSync(SUBMISSIONS_FILE, 'utf8')); } catch (e) { appSubmissions = {}; }
    }

    let activationSubmissions = {};
    if (fs.existsSync(ACTIVATION_SUBMISSIONS_FILE)) {
        try { activationSubmissions = JSON.parse(fs.readFileSync(ACTIVATION_SUBMISSIONS_FILE, 'utf8')); } catch (e) { activationSubmissions = {}; }
    }

    res.render('admin', {
        supportApps,
        newsList,
        storeProducts,
        appsList,
        appSubmissions,
        activationSubmissions,
        message: req.query.msg || null,
        user: req.user
    });
});

app.post('/admin/activation-action', checkAdmin, async (req, res) => {
    const { submissionId, action, roleId } = req.body;
    let submissions = fs.existsSync(ACTIVATION_SUBMISSIONS_FILE) ? JSON.parse(fs.readFileSync(ACTIVATION_SUBMISSIONS_FILE, 'utf8')) : {};

    if (submissions[submissionId]) {
        const targetUserId = submissions[submissionId].discordId;

        if (action === 'accept') {
            submissions[submissionId].status = 'مقبول';
            if (roleId) {
                try {
                    await axios.put(
                        `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${targetUserId}/roles/${roleId}`,
                        {},
                        {
                            headers: {
                                Authorization: `Bot ${process.env.BOT_TOKEN}`,
                                'Content-Type': 'application/json'
                            }
                        }
                    );
                } catch (e) {
                    console.error("خطأ في إعطاء رتبة التفعيل للمتقدم:", e.message);
                }
            }
        } else if (action === 'reject') {
            submissions[submissionId].status = 'مرفوض';
           
            try {
                const dmChannelRes = await axios.post(
                    `https://discord.com/api/v10/users/@me/channels`,
                    { recipient_id: targetUserId },
                    {
                        headers: {
                            Authorization: `Bot ${process.env.BOT_TOKEN}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );
               
                const channelId = dmChannelRes.data.id;

                await axios.post(
                    `https://discord.com/api/v10/channels/${channelId}/messages`,
                    {
                        content: "يا طويل العمر، نعتذر منك لعدم قبول طلب التفعيل الحالي، ولا تهون حاول مرة أخرى وشد حيلك وفي انتضارك معنا قريباً إن شاء الله."
                    },
                    {
                        headers: {
                            Authorization: `Bot ${process.env.BOT_TOKEN}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );
            } catch (e) {
                console.error("خطأ في إرسال رسالة الرفض الخاصة للمستخدم:", e.message);
            }

        } else if (action === 'delete') {
            delete submissions[submissionId];
        }

        fs.writeFileSync(ACTIVATION_SUBMISSIONS_FILE, JSON.stringify(submissions, null, 2));
    }
    res.redirect('/admin?msg=تم تحديث طلب التفعيل بنجاح');
});

app.post('/admin/submission-action', checkAdmin, async (req, res) => {
    const { submissionId, action, roleId } = req.body;
    let submissions = fs.existsSync(SUBMISSIONS_FILE) ? JSON.parse(fs.readFileSync(SUBMISSIONS_FILE, 'utf8')) : {};

    if (submissions[submissionId]) {
        const targetUserId = submissions[submissionId].discordId;

        if (action === 'accept') {
            submissions[submissionId].status = 'مقبول';
            if (roleId) {
                try {
                    await axios.put(
                        `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${targetUserId}/roles/${roleId}`,
                        {},
                        {
                            headers: {
                                Authorization: `Bot ${process.env.BOT_TOKEN}`,
                                'Content-Type': 'application/json'
                            }
                        }
                    );
                } catch (e) {
                    console.error("خطأ في إعطاء الرتبة للمتقدم:", e.message);
                }
            }
        } else if (action === 'reject') {
            submissions[submissionId].status = 'مرفوض';
        } else if (action === 'delete') {
            delete submissions[submissionId];
        }

        fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify(submissions, null, 2));
    }
    res.redirect('/admin?msg=تم تحديث حالة التقديم بنجاح');
});

app.post('/admin/support-action', checkAdmin, async (req, res) => {
    const { userId, action } = req.body;
    let supportApps = fs.existsSync(SUPPORT_APPLICANTS_FILE) ? JSON.parse(fs.readFileSync(SUPPORT_APPLICANTS_FILE, 'utf8')) : {};

    if (supportApps[userId]) {
        if (action === 'accept') {
            try {
                const acceptedRoleId = '1525904436529201152';
                await axios.put(
                    `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${userId}/roles/${acceptedRoleId}`,
                    {},
                    {
                        headers: {
                            Authorization: `Bot ${process.env.BOT_TOKEN}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );
                supportApps[userId].status = 'مقبول';
            } catch (e) {
                console.error("خطأ في إعطاء الرتبة:", e.message);
            }
        } else {
            supportApps[userId].status = 'مرفوض';
        }
        fs.writeFileSync(SUPPORT_APPLICANTS_FILE, JSON.stringify(supportApps, null, 2));
    }
    res.redirect('/admin?msg=تم تحديث حالة المتقدم بنجاح');
});

app.post('/admin/support-delete', checkAdmin, (req, res) => {
    const { userId } = req.body;
    let supportApps = fs.existsSync(SUPPORT_APPLICANTS_FILE) ? JSON.parse(fs.readFileSync(SUPPORT_APPLICANTS_FILE, 'utf8')) : {};

    if (supportApps[userId]) {
        delete supportApps[userId];
        fs.writeFileSync(SUPPORT_APPLICANTS_FILE, JSON.stringify(supportApps, null, 2));
    }
    res.redirect('/admin?msg=تم حذف طلب التقديم بنجاح');
});

app.post('/admin/add-news', checkAdmin, (req, res) => {
    const { title, content } = req.body;
    let newsList = [];
   
    if (fs.existsSync(NEWS_FILE)) {
        try { newsList = JSON.parse(fs.readFileSync(NEWS_FILE, 'utf8')); if (!Array.isArray(newsList)) newsList = []; } catch (e) { newsList = []; }
    }
   
    newsList.push({
        id: Date.now(),
        title: title || "بدون عنوان",
        content: content || "",
        date: new Date().toLocaleDateString('ar-SA')
    });
   
    fs.writeFileSync(NEWS_FILE, JSON.stringify(newsList, null, 2));
    res.redirect('/admin?msg=تم نشر الخبر بنجاح');
});

app.post('/admin/add-product', checkAdmin, (req, res) => {
    const { name, price, description } = req.body;
    let storeProducts = [];
   
    if (fs.existsSync(STORE_FILE)) {
        try { storeProducts = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); if (!Array.isArray(storeProducts)) storeProducts = []; } catch (e) { storeProducts = []; }
    }
   
    storeProducts.push({
        id: Date.now(),
        name: name || "منتج بدون اسم",
        price: price || "0",
        description: description || ""
    });
   
    fs.writeFileSync(STORE_FILE, JSON.stringify(storeProducts, null, 2));
    res.redirect('/admin?msg=تم إضافة المنتج للمتجر بنجاح');
});

app.post('/admin/add-application', checkAdmin, (req, res) => {
    const { title, description, questions } = req.body;
    let appsList = [];
   
    if (fs.existsSync(APPS_CONFIG_FILE)) {
        try {
            const parsedData = JSON.parse(fs.readFileSync(APPS_CONFIG_FILE, 'utf8'));
            if (Array.isArray(parsedData)) appsList = parsedData;
            else if (parsedData && typeof parsedData === 'object') appsList = Object.values(parsedData);
        } catch (e) { appsList = []; }
    }
   
    let formattedQuestions = [];
    if (questions) {
        if (Array.isArray(questions)) {
            formattedQuestions = questions.filter(q => q && q.trim() !== '');
        } else if (typeof questions === 'string' && questions.trim() !== '') {
            formattedQuestions = [questions];
        }
    }

    appsList.push({
        id: Date.now(),
        title: title || "تقديم جديد",
        description: description || "",
        questions: formattedQuestions
    });
   
    fs.writeFileSync(APPS_CONFIG_FILE, JSON.stringify(appsList, null, 2));
    res.redirect('/admin?msg=تم فتح التقديم الجديد مع أسئلته بنجاح');
});

app.post('/admin/delete-application', checkAdmin, (req, res) => {
    const { appId } = req.body;
    let appsList = [];
   
    if (fs.existsSync(APPS_CONFIG_FILE)) {
        try {
            const parsedData = JSON.parse(fs.readFileSync(APPS_CONFIG_FILE, 'utf8'));
            if (Array.isArray(parsedData)) appsList = parsedData;
            else if (parsedData && typeof parsedData === 'object') appsList = Object.values(parsedData);
        } catch (e) { appsList = []; }
    }
   
    appsList = appsList.filter(app => app.id != appId);
    fs.writeFileSync(APPS_CONFIG_FILE, JSON.stringify(appsList, null, 2));
    res.redirect('/admin?msg=تم حذف التقديم بنجاح');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`السيرفر يعمل على المنفذ: ${PORT}`); });