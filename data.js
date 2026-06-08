/* ============================================================
   data.js — Shared Data Layer for ماركت الكفيل
   Uses Supabase as backend with real-time subscriptions
   Performance-optimized with localStorage caching
   ============================================================ */

// ══════════════════════════════════════════════════════════════
// Backend config loads from env.js (gitignored) so the project URL +
// anon key never enter this PUBLIC repo. Copy env.example.js → env.js
// and fill in your values; it is <script>-loaded BEFORE data.js in
// index.html / admin.html. Without env.js the app falls back to
// placeholders and runs on local FALLBACK_MENU only.
//   NOTE: the Supabase anon key is browser-safe by design, but this repo
//   is public and `orders` rows carry customer phone/address — so the
//   real key is deliberately kept out of git.
// ══════════════════════════════════════════════════════════════
const _KENV = (typeof window !== 'undefined' && window.KAFEEL_ENV) || {};
const SUPABASE_URL = _KENV.SUPABASE_URL || 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = _KENV.SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY';
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// ⬇️  PASTE YOUR FIREBASE CONFIG HERE  (Project settings → Web app)  ⬇️
//     Create a NEW Firebase project for Kafeel Market push notifications.
//     The same values must also be set in sw.js.
// ══════════════════════════════════════════════════════════════
const FIREBASE_CONFIG = _KENV.FIREBASE_CONFIG || {
  apiKey: 'YOUR_FIREBASE_API_KEY',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  projectId: 'YOUR_PROJECT',
  storageBucket: 'YOUR_PROJECT.firebasestorage.app',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID',
};
const FCM_VAPID_KEY = _KENV.FCM_VAPID_KEY || 'YOUR_FCM_VAPID_KEY';   // Cloud Messaging → Web Push certificates
// ══════════════════════════════════════════════════════════════

// ─── Supabase Client ────────────────────────────────────────
// While the config above is still a placeholder, fall back to a harmless
// no-op stub so the app still loads (showing FALLBACK_MENU) instead of
// crashing on an invalid URL. Once real credentials are pasted, the real
// client is used automatically.
const SUPABASE_CONFIGURED =
  /^https:\/\/.+/.test(SUPABASE_URL) &&
  SUPABASE_URL.indexOf('YOUR_') === -1 &&
  String(SUPABASE_ANON_KEY).indexOf('YOUR_') === -1;

function _makeSupabaseStub() {
  console.warn('[Kafeel] Supabase not configured yet — running on local fallback data only.');
  const err = { message: 'supabase_not_configured' };
  const result = Promise.resolve({ data: null, error: err });
  const qb = {
    select() { return this; }, insert() { return this; }, update() { return this; },
    delete() { return this; }, upsert() { return this; }, eq() { return this; },
    in() { return this; }, gt() { return this; }, lt() { return this; },
    order() { return this; }, limit() { return this; },
    single() { return result; }, maybeSingle() { return result; },
    then(onF, onR) { return result.then(onF, onR); },
  };
  const channel = { on() { return this; }, subscribe() { return this; } };
  return {
    from() { return qb; },
    rpc() { return result; },
    channel() { return channel; },
    removeChannel() {},
    auth: {
      getSession() { return Promise.resolve({ data: { session: null }, error: null }); },
      signInWithPassword() { return Promise.resolve({ data: null, error: err }); },
      signOut() { return Promise.resolve({ error: null }); },
    },
    functions: { invoke() { return result; } },
    storage: {
      from() {
        return {
          upload() { return result; },
          getPublicUrl() { return { data: { publicUrl: '' } }; },
        };
      },
    },
  };
}

const _supabase = SUPABASE_CONFIGURED
  ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        storage: localStorage,
      },
    })
  : _makeSupabaseStub();

// ─── Firebase Messaging Setup ────────────────────────────────
let _fcmToken = null;

async function initFirebaseMessaging() {
  try {
    if (typeof firebase === 'undefined' || !firebase.messaging) {
      console.warn('Firebase SDK not loaded');
      return null;
    }

    firebase.initializeApp(FIREBASE_CONFIG);
    const messaging = firebase.messaging();

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('Notification permission denied');
      return null;
    }

    const swReg = await navigator.serviceWorker.ready;

    _fcmToken = await messaging.getToken({
      vapidKey: FCM_VAPID_KEY,
      serviceWorkerRegistration: swReg,
    });
    console.debug('FCM token obtained');

    messaging.onMessage((payload) => {
      const title = payload.notification?.title || 'ماركت الكفيل';
      const body = payload.notification?.body || '';
      swReg.showNotification(title, {
        body: body,
        icon: 'assets/kafeel_icon.png',
        tag: 'kafeel-order-fg-' + Date.now(),
        vibrate: [200, 100, 200],
      });
    });

    return _fcmToken;
  } catch (err) {
    console.warn('Firebase messaging init failed:', err);
    return null;
  }
}

function getFCMToken() {
  return _fcmToken;
}

async function savePushToken(orderId, token) {
  if (!token) return;
  const { error } = await _supabase
    .from('push_tokens')
    .upsert({ order_id: orderId, fcm_token: token }, { onConflict: 'order_id,fcm_token' });
  return { success: !error };
}

// ─── Constants ───────────────────────────────────────────────
// NOTE: These three values are mirrored server-side in security-fixes.sql
// (create_order). If you change them here, update the SQL too.
const DELIVERY_FEE_AMOUNT = 1000;
const FREE_DELIVERY_THRESHOLD = 5000;

function getDeliveryFee(subtotal) {
  return subtotal < FREE_DELIVERY_THRESHOLD ? DELIVERY_FEE_AMOUNT : 0;
}
const MIN_ORDER = 3000;

// ─── Categories (imported from source catalog) ──────────────
const CATEGORIES = [
  'قسم المواد الغذائية',
  'قسم المنظفات',
  'الفطائر والمقبلات',
  'معطرات جو + الأرضيات',
  'إفطار صباحي',
  'البطاريات',
  'الشامبو',
  'المشروبات الغازية والعصائر',
  'جكليت وسلات هدايا',
  'قرطاسية',
  'قسم الاجباس',
  'قسم الاجبان',
  'قسم الالبان',
  'قسم البقوليات',
  'قسم البهارات',
  'قسم الحفاظات',
  'قسم الحلويات',
  'قسم الحليب السائل',
  'قسم الدايت',
  'قسم الزيوت',
  'قسم السكائر',
  'قسم الشاي والقهوة',
  'قسم الصلصات',
  'قسم العطور',
  'قسم الكرزات',
  'قسم اللحوم',
  'قسم المخللات',
  'قسم المعلبات',
  'قسم المواد السفري',
  'قسم المياه',
  'قسم الورقيات',
  'قسم حليب ومستلزمات الاطفال',
  'قسم مواد خالية من الغلوتين',
  'كيك و معجنات',
  'مخبوزات',
  'مستلزمات اعياد ميلاد ومناسبات',
  'مشروبات الطاقة',
  'معكرونية وشوربة جاهزة',
  'منتجات الورد البغدادي',
  'منتجات شركة البوادي',
  'منتجات مخابز الريف',
];
const CATEGORY_ICONS = {}; // emojis removed — UI uses SVG icons now
const CATEGORY_IMAGES = {
  'قسم المواد الغذائية': 'assets/categories/cat_3.jpg',
  'قسم المنظفات': 'assets/categories/cat_2.jpg',
  'الفطائر والمقبلات': 'assets/categories/cat_696b56d441f361964749.jpg',
  'معطرات جو + الأرضيات': 'assets/categories/cat_693ee59141f361964752.jpg',
  'إفطار صباحي': 'assets/categories/cat_37.jpg',
  'البطاريات': 'assets/categories/cat_32.jpg',
  'الشامبو': 'assets/categories/cat_40.jpg',
  'المشروبات الغازية والعصائر': 'assets/categories/cat_8.jpg',
  'جكليت وسلات هدايا': 'assets/categories/cat_18.jpg',
  'قرطاسية': 'assets/categories/cat_4.jpg',
  'قسم الاجباس': 'assets/categories/cat_20.jpg',
  'قسم الاجبان': 'assets/categories/cat_19.jpg',
  'قسم الالبان': 'assets/categories/cat_44.jpg',
  'قسم البقوليات': 'assets/categories/cat_10.jpg',
  'قسم البهارات': 'assets/categories/cat_21.jpg',
  'قسم الحفاظات': 'assets/categories/cat_17.jpg',
  'قسم الحلويات': 'assets/categories/cat_5.jpg',
  'قسم الحليب السائل': 'assets/categories/cat_43.jpg',
  'قسم الدايت': 'assets/categories/cat_33.jpg',
  'قسم الزيوت': 'assets/categories/cat_9.jpg',
  'قسم السكائر': 'assets/categories/cat_1.jpg',
  'قسم الشاي والقهوة': 'assets/categories/cat_14.jpg',
  'قسم الصلصات': 'assets/categories/cat_31.jpg',
  'قسم العطور': 'assets/categories/cat_12.jpg',
  'قسم الكرزات': 'assets/categories/cat_6.jpg',
  'قسم اللحوم': 'assets/categories/cat_22.jpg',
  'قسم المخللات': 'assets/categories/cat_7.jpg',
  'قسم المعلبات': 'assets/categories/cat_30.jpg',
  'قسم المواد السفري': 'assets/categories/cat_15.jpg',
  'قسم المياه': 'assets/categories/cat_28.jpg',
  'قسم الورقيات': 'assets/categories/cat_16.jpg',
  'قسم حليب ومستلزمات الاطفال': 'assets/categories/cat_13.jpg',
  'قسم مواد خالية من الغلوتين': 'assets/categories/cat_34.jpg',
  'كيك و معجنات': 'assets/categories/cat_26.jpg',
  'مخبوزات': 'assets/categories/cat_36.jpg',
  'مستلزمات اعياد ميلاد ومناسبات': 'assets/categories/cat_38.jpg',
  'مشروبات الطاقة': 'assets/categories/cat_41.jpg',
  'معكرونية وشوربة جاهزة': 'assets/categories/cat_35.jpg',
  'منتجات الورد البغدادي': 'assets/categories/cat_48.jpg',
  'منتجات شركة البوادي': 'assets/categories/cat_24.jpg',
  'منتجات مخابز الريف': 'assets/categories/cat_45.jpg',
};

// ─── Fallback Menu (offline sample; full catalog lives in Supabase) ──
const FALLBACK_MENU = [
  {id:'6a1a9b9813c8bd65da87f279',name:'حليب ديالاك مكثف *380 غرام',description:'',category:'قسم المواد الغذائية',price:1000,image:'assets/products/6a1a9b9813c8bd65da87f279.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a1a9b9813c8bd65da87f273',name:'معجون طماطم الدرة * 1100 غرام',description:'',category:'قسم المواد الغذائية',price:3900,image:'assets/products/6a1a9b9813c8bd65da87f273.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a1a9b9813c8bd65da87f26d',name:'مخلل خيار الدرة * 700 غرام',description:'',category:'قسم المواد الغذائية',price:5900,image:'assets/products/6a1a9b9813c8bd65da87f26d.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a1a9b9813c8bd65da87f267',name:'حمص بطحينة الدرة * 400 غرام',description:'',category:'قسم المواد الغذائية',price:1650,image:'assets/products/6a1a9b9813c8bd65da87f267.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69b18943c71cd2514c067471',name:'صابون كونفي * 70 غرام',description:'',category:'قسم المنظفات',price:250,image:'assets/products/69b18943c71cd2514c067471.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a21681f13c8bd65daa7e216',name:'اقراص غسالة صحون فنش * 36',description:'',category:'قسم المنظفات',price:8250,image:'assets/products/6a21681f13c8bd65daa7e216.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a21681f13c8bd65daa7e210',name:'اقراص غسالة صحون سوزاكس *33',description:'',category:'قسم المنظفات',price:6900,image:'assets/products/6a21681f13c8bd65daa7e210.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a21681f13c8bd65daa7e20a',name:'مطهر ومعقم عام حياة',description:'',category:'قسم المنظفات',price:650,image:'assets/products/6a21681f13c8bd65daa7e20a.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6914740441f36196471af025',name:'باودر معطر سجاد',description:'',category:'معطرات جو + الأرضيات',price:4350,image:'assets/products/6914740441f36196471af025.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69145c1941f36196471abc87',name:'معطر حمام',description:'',category:'معطرات جو + الأرضيات',price:4250,image:'assets/products/69145c1941f36196471abc87.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69145bca41f36196471abbbb',name:'معطر حمام',description:'',category:'معطرات جو + الأرضيات',price:4250,image:'assets/products/69145bca41f36196471abbbb.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69145a8a41f36196471ab953',name:'سلفر برايت معطر جو 450مل',description:'',category:'معطرات جو + الأرضيات',price:1750,image:'assets/products/69145a8a41f36196471ab953.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69a19093c71cd2514cb10bda',name:'مربى امريكانا * 360 غرام',description:'',category:'إفطار صباحي',price:2250,image:'assets/products/69a19093c71cd2514cb10bda.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6965db3041f361964719db67',name:'دبس برحي العطاء',description:'',category:'إفطار صباحي',price:2250,image:'assets/products/6965db3041f361964719db67.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6949966d41f3619647d39457',name:'جبن عرب بقر',description:'',category:'إفطار صباحي',price:9000,image:'assets/products/6949966d41f3619647d39457.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6949966d41f3619647d39406',name:'زيتون محشي جبن',description:'',category:'إفطار صباحي',price:20000,image:'assets/products/6949966d41f3619647d39406.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69f1c2e25201e3af1872da2a',name:'بطاريات دوراسيل 9V',description:'',category:'البطاريات',price:7500,image:'',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69f1c2e25201e3af1872da24',name:'بطاريات دوراسيل توربو  AAA8',description:'',category:'البطاريات',price:9250,image:'',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69f1c2e25201e3af1872da1e',name:'بطاريات دوراسيل   CR2032',description:'',category:'البطاريات',price:3750,image:'',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69f1c2e25201e3af1872da18',name:'بطاريات دوراسيل  C2',description:'',category:'البطاريات',price:4750,image:'',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a1aa3e013c8bd65da885f0a',name:'شامبو جونسون بالكاموميل * 200 مل',description:'',category:'الشامبو',price:2600,image:'assets/products/6a1aa3e013c8bd65da885f0a.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a08619ade01713c11278426',name:'لوشن جونسون للاطفال * 200 مل',description:'',category:'الشامبو',price:2750,image:'assets/products/6a08619ade01713c11278426.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69e21e2f539c5ebf3f00732b',name:'مكيف شعر د.نورا الاردني *500 مل',description:'',category:'الشامبو',price:4750,image:'assets/products/69e21e2f539c5ebf3f00732b.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69e21e2f539c5ebf3f007325',name:'شامبو د.نورا الاردني بالاعشاب والفواكة * 500 مل',description:'',category:'الشامبو',price:4750,image:'assets/products/69e21e2f539c5ebf3f007325.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69f5a13236b169fe41362a89',name:'عصير ناون الفيتنامي بالفواكة الاستوائية * 250 مل',description:'',category:'المشروبات الغازية والعصائر',price:900,image:'assets/products/69f5a13236b169fe41362a89.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69f5a13236b169fe41362a83',name:'عصير بيست الفيتنامي * 330 مل',description:'',category:'المشروبات الغازية والعصائر',price:900,image:'assets/products/69f5a13236b169fe41362a83.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69e9c93c5201e3af184f85ce',name:'عصير الربيع * 125 مل',description:'',category:'المشروبات الغازية والعصائر',price:4500,image:'assets/products/69e9c93c5201e3af184f85ce.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69e9c93c5201e3af184f85c8',name:'مشروب طاقة نيكست ليفل * 250 مل',description:'',category:'المشروبات الغازية والعصائر',price:1000,image:'assets/products/69e9c93c5201e3af184f85c8.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69b6993fc71cd2514c3626a1',name:'عرض خاص شوكولا فيريرو',description:'',category:'جكليت وسلات هدايا',price:5750,image:'assets/products/69b6993fc71cd2514c3626a1.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a08619ade01713c112783f0',name:'ساعة رولكس',description:'',category:'جكليت وسلات هدايا',price:28000,image:'',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69e21e86539c5ebf3f007b98',name:'شوكولا دارك كرات *800 غرام',description:'',category:'جكليت وسلات هدايا',price:7750,image:'',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69e21e86539c5ebf3f007b92',name:'نوكا كرانش ميكس * 1 كيلو',description:'',category:'جكليت وسلات هدايا',price:7750,image:'',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a1a9efc13c8bd65da885472',name:'فانتا ياباني * 330 مل',description:'',category:'قسم الاجباس',price:3750,image:'assets/products/6a1a9efc13c8bd65da885472.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a1a9efc13c8bd65da88546c',name:'جبس تاكيز * 90 غرام',description:'',category:'قسم الاجباس',price:6900,image:'assets/products/6a1a9efc13c8bd65da88546c.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a1a9efc13c8bd65da885466',name:'جبس ليز عائلي ميكا ملك اللمة',description:'',category:'قسم الاجباس',price:1850,image:'assets/products/6a1a9efc13c8bd65da885466.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a0d80ef13c8bd65da410483',name:'جبس البطاطا سنبس * 120 غرام',description:'',category:'قسم الاجباس',price:2000,image:'assets/products/6a0d80ef13c8bd65da410483.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a1a9c0913c8bd65da884201',name:'زبد البقرتين حيواني غير مملح * 100 غرام',description:'',category:'قسم الاجبان',price:750,image:'assets/products/6a1a9c0913c8bd65da884201.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a1a9c0913c8bd65da8841fb',name:'زبد البقرتين  حيواني مملح * 100 غرام',description:'',category:'قسم الاجبان',price:750,image:'assets/products/6a1a9c0913c8bd65da8841fb.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a1a9c0913c8bd65da8841f5',name:'عرض جبن اماه + قشطة كالة * 50 غرام',description:'',category:'قسم الاجبان',price:200,image:'assets/products/6a1a9c0913c8bd65da8841f5.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a11a15613c8bd65da50bf4d',name:'جبن بالاعشاب مرسين * 200 غرام',description:'',category:'قسم الاجبان',price:2900,image:'assets/products/6a11a15613c8bd65da50bf4d.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'699d4ab6c71cd2514c918c9f',name:'زبادي سفن الكفيل * 800 غرام',description:'',category:'قسم الالبان',price:1600,image:'assets/products/699d4ab6c71cd2514c918c9f.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a08619ade01713c1127848a',name:'زبادي المراعي * 180 غرام',description:'',category:'قسم الالبان',price:500,image:'assets/products/6a08619ade01713c1127848a.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69e9cadb5201e3af184fca7b',name:'قشطة قدح يورك سوت * 100 غرام',description:'',category:'قسم الالبان',price:500,image:'assets/products/69e9cadb5201e3af184fca7b.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69d519c272b30d43d9817cb4',name:'لبن رائب ابو غريب *750 غرام',description:'',category:'قسم الالبان',price:1000,image:'assets/products/69d519c272b30d43d9817cb4.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a086199de01713c11278179',name:'رز جيهان كيس قماش * 4.5 كيلو',description:'',category:'قسم البقوليات',price:9150,image:'assets/products/6a086199de01713c11278179.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69f1c1b55201e3af1872a5f0',name:'فول الطازج * 400 غرام',description:'',category:'قسم البقوليات',price:750,image:'assets/products/69f1c1b55201e3af1872a5f0.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69f1c1b55201e3af1872a5ea',name:'بزاليا الطازج * 400 غرام',description:'',category:'قسم البقوليات',price:750,image:'assets/products/69f1c1b55201e3af1872a5ea.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69f1c1b55201e3af1872a5e4',name:'حمص حب الطازج * 400 غرام',description:'',category:'قسم البقوليات',price:750,image:'assets/products/69f1c1b55201e3af1872a5e4.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a08619ade01713c112783d8',name:'مسحوق كاري حار اسناد * 200 غرام',description:'',category:'قسم البهارات',price:2900,image:'assets/products/6a08619ade01713c112783d8.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a08619ade01713c112783d2',name:'توابل المشويات اسناد * 200 غرام',description:'',category:'قسم البهارات',price:2900,image:'assets/products/6a08619ade01713c112783d2.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a08619ade01713c112783cc',name:'البهارات السبعة اسناد * 200 غرام',description:'',category:'قسم البهارات',price:2900,image:'assets/products/6a08619ade01713c112783cc.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a08619ade01713c112783c6',name:'مسحوق الكاري المعتدل * 200 غرام',description:'',category:'قسم البهارات',price:2900,image:'assets/products/6a08619ade01713c112783c6.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69f59ff736b169fe4135e557',name:'حفاضات كبار السن لايفري كبير جدا *9',description:'',category:'قسم الحفاظات',price:9000,image:'assets/products/69f59ff736b169fe4135e557.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69f59ff736b169fe4135e551',name:'حفاضات لايفري كبار السن صغير *18',description:'',category:'قسم الحفاظات',price:9000,image:'assets/products/69f59ff736b169fe4135e551.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69f59ff736b169fe4135e54b',name:'سوفي نضافة وطهارة فوط يومية عادي * 120',description:'',category:'قسم الحفاظات',price:6150,image:'assets/products/69f59ff736b169fe4135e54b.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69f59ff736b169fe4135e545',name:'سوفي نضافة وطهارة فوط يومية كبير * 114',description:'',category:'قسم الحفاظات',price:6750,image:'assets/products/69f59ff736b169fe4135e545.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a22904113c8bd65daac1366',name:'حليب ديالاك قوطية * 2 كيلو',description:'',category:'قسم الحلويات',price:18250,image:'assets/products/6a22904113c8bd65daac1366.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69455e7141f361964753e017',name:'اصابع نيسكويك * 26 غرام',description:'',category:'قسم الحلويات',price:3000,image:'assets/products/69455e7141f361964753e017.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69455e7141f361964753e011',name:'اصابع نيسكويك * 26 غرام',description:'',category:'قسم الحلويات',price:250,image:'assets/products/69455e7141f361964753e011.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69455e7141f361964753e00b',name:'جولز كراكر * 50 غرام',description:'',category:'قسم الحلويات',price:25750,image:'assets/products/69455e7141f361964753e00b.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'699d8115c71cd2514c922d02',name:'حليب صويا  فيتاميلك *300 مل',description:'',category:'قسم الحليب السائل',price:1750,image:'assets/products/699d8115c71cd2514c922d02.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'699d8115c71cd2514c922cf5',name:'حليب كاله *125 مل',description:'',category:'قسم الحليب السائل',price:5250,image:'assets/products/699d8115c71cd2514c922cf5.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'699d8115c71cd2514c922cef',name:'حليب كاله *125 مل',description:'',category:'قسم الحليب السائل',price:250,image:'assets/products/699d8115c71cd2514c922cef.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'699d8115c71cd2514c922cdb',name:'حليب مبخر لونا *159 مل',description:'',category:'قسم الحليب السائل',price:1100,image:'assets/products/699d8115c71cd2514c922cdb.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a086197de01713c11277b51',name:'شوكولا بالشوفان كوباردي الروسي كيس * 120 غرام',description:'',category:'قسم الدايت',price:2000,image:'assets/products/6a086197de01713c11277b51.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69bbcf0572b30d43d9fccaaf',name:'نستلة ويفر كولون بالشوكولا دايت *30 غرام',description:'',category:'قسم الدايت',price:11000,image:'assets/products/69bbcf0572b30d43d9fccaaf.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a266d8613c8bd65dabe38a8',name:'ستيفيانا المحلى علبة * 200 غرام',description:'',category:'قسم الدايت',price:0,image:'',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a266d8613c8bd65dabe38a2',name:'ستيفيانا المحلى علبة * 200 غرام',description:'',category:'قسم الدايت',price:7400,image:'',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a0b2c9713c8bd65da3e2128',name:'بزاليا بالجزر التونسا * 400 غرام',description:'',category:'قسم الزيوت',price:750,image:'assets/products/6a0b2c9713c8bd65da3e2128.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a0b2c9713c8bd65da3e211c',name:'دهن التونسا * 5 لتر',description:'',category:'قسم الزيوت',price:16000,image:'assets/products/6a0b2c9713c8bd65da3e211c.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69e21dbc539c5ebf3f004fa1',name:'دهن زير * 12 لتر',description:'',category:'قسم الزيوت',price:33000,image:'assets/products/69e21dbc539c5ebf3f004fa1.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69e21dbc539c5ebf3f004f8f',name:'زبد ابو غريب',description:'',category:'قسم الزيوت',price:1250,image:'assets/products/69e21dbc539c5ebf3f004f8f.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a1efb7813c8bd65da9ce293',name:'نركيلة الكترونية سموك * 1000 نفس',description:'',category:'قسم السكائر',price:6000,image:'assets/products/6a1efb7813c8bd65da9ce293.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a1efb7813c8bd65da9ce28d',name:'نركيلة الكترونية فوزل * 12 الف نفس',description:'',category:'قسم السكائر',price:13000,image:'assets/products/6a1efb7813c8bd65da9ce28d.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a1efb7813c8bd65da9ce287',name:'نركيلة الكترونية هوكا * 80 الف نفس',description:'',category:'قسم السكائر',price:19000,image:'assets/products/6a1efb7813c8bd65da9ce287.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a1efb7813c8bd65da9ce281',name:'نركيلة الكترونية مزايا * 80 الف سحبة',description:'',category:'قسم السكائر',price:20000,image:'assets/products/6a1efb7813c8bd65da9ce281.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a08619ade01713c112784a8',name:'شاي البهلول دبة * 1 كيلو',description:'',category:'قسم الشاي والقهوة',price:7000,image:'assets/products/6a08619ade01713c112784a8.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a08619ade01713c112783ea',name:'شاي العطار بالاعشاب *20',description:'',category:'قسم الشاي والقهوة',price:3400,image:'assets/products/6a08619ade01713c112783ea.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a08619ade01713c112783e4',name:'شاي العطار الطبيعي *20',description:'',category:'قسم الشاي والقهوة',price:3400,image:'assets/products/6a08619ade01713c112783e4.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a08619ade01713c1127839c',name:'بن النجار اللبناني * 200 غرام',description:'',category:'قسم الشاي والقهوة',price:4900,image:'assets/products/6a08619ade01713c1127839c.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69e9c9bb5201e3af184fa80d',name:'معطر جو اير بيبي حبيبات 3*1  * 240 غرام',description:'',category:'قسم الصلصات',price:2400,image:'assets/products/69e9c9bb5201e3af184fa80d.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a228fe613c8bd65daabcac4',name:'صلصة سمبل حلوة حارة زجاجي * 300 مل',description:'',category:'قسم الصلصات',price:1600,image:'',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a11a17e13c8bd65da50d512',name:'كريم كيك بلجيكي بخاخ * 232 مل',description:'',category:'قسم الصلصات',price:6750,image:'',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a11a17e13c8bd65da50d50c',name:'كريمة الخفق مرسين * 1 لتر',description:'',category:'قسم الصلصات',price:4000,image:'',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69e21df4539c5ebf3f0067ce',name:'عطر صعب الاماراتي',description:'',category:'قسم العطور',price:32000,image:'assets/products/69e21df4539c5ebf3f0067ce.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69e21df4539c5ebf3f0067c8',name:'عطر الوسام الرصاصي',description:'',category:'قسم العطور',price:36000,image:'assets/products/69e21df4539c5ebf3f0067c8.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69b69979c71cd2514c362c67',name:'معطر جسم اطفال سيلفر فش * 120 مل',description:'',category:'قسم العطور',price:1750,image:'assets/products/69b69979c71cd2514c362c67.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a22902713c8bd65daabf075',name:'عطر الجسمي الاماراتي * 100 مل',description:'',category:'قسم العطور',price:80000,image:'',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a08619bde01713c112784ea',name:'فراولة مجففة علبة',description:'',category:'قسم الكرزات',price:3500,image:'',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a08619ade01713c112782db',name:'مكدامية',description:'',category:'قسم الكرزات',price:31000,image:'',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a08619ade01713c112782ab',name:'سجق تركي',description:'',category:'قسم الكرزات',price:4500,image:'',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a08619ade01713c11278281',name:'تين سلة * 1 كيلو',description:'',category:'قسم الكرزات',price:14000,image:'',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a0d80e713c8bd65da410120',name:'روبيان مقشر جامبو الكفيل * 400 غرام',description:'',category:'قسم اللحوم',price:8750,image:'assets/products/6a0d80e713c8bd65da410120.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a0d80e713c8bd65da41011a',name:'دجاج الكفيل * 1400 غرام',description:'',category:'قسم اللحوم',price:5750,image:'assets/products/6a0d80e713c8bd65da41011a.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69f1c21c5201e3af1872bcb1',name:'دجاج الكفيل * 1600 غرام',description:'',category:'قسم اللحوم',price:6500,image:'assets/products/69f1c21c5201e3af1872bcb1.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69f1c21c5201e3af1872bcab',name:'دجاج الكفيل * 1800 غرام',description:'',category:'قسم اللحوم',price:7250,image:'assets/products/69f1c21c5201e3af1872bcab.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69e9c9275201e3af184f7f2a',name:'خل التفاح اميريكان كاردن * 500 مل',description:'',category:'قسم المخللات',price:3000,image:'assets/products/69e9c9275201e3af184f7f2a.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69d5194272b30d43d98152e2',name:'ل التفاح اشكم * 3 لتر',description:'',category:'قسم المخللات',price:2450,image:'assets/products/69d5194272b30d43d98152e2.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69d5194272b30d43d98152dc',name:'خل ابيض اشكم * 500 مل',description:'',category:'قسم المخللات',price:950,image:'assets/products/69d5194272b30d43d98152dc.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69d5194272b30d43d98152d6',name:'مكدوس باذنجان شامي الاحلام *400 غرام',description:'',category:'قسم المخللات',price:2250,image:'assets/products/69d5194272b30d43d98152d6.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a08619ade01713c112783ba',name:'شرائح لحم تونا ياقوت * 140 غرام',description:'',category:'قسم المعلبات',price:1250,image:'assets/products/6a08619ade01713c112783ba.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a08619ade01713c112782cf',name:'بزاليا بالجزر الطازج* 400 غرام',description:'',category:'قسم المعلبات',price:750,image:'assets/products/6a08619ade01713c112782cf.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a08619ade01713c112782b1',name:'سمك سردين سيبلو * 125 غرام',description:'',category:'قسم المعلبات',price:1150,image:'assets/products/6a08619ade01713c112782b1.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69e9c9a75201e3af184fa143',name:'ذرة مرسين *3*200 غرام',description:'',category:'قسم المعلبات',price:2750,image:'assets/products/69e9c9a75201e3af184fa143.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69f1c1df5201e3af1872b1fc',name:'ماعون ريزو مطبوع',description:'',category:'قسم المواد السفري',price:200,image:'',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69f1c1df5201e3af1872b1f6',name:'ماعون كيك لماع دائري *20',description:'',category:'قسم المواد السفري',price:850,image:'',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69f1c1df5201e3af1872b1f0',name:'قاعدة فرشاة اسنان',description:'',category:'قسم المواد السفري',price:2000,image:'',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69f1c1dd5201e3af1872ae4e',name:'ماعون كيك ذهبي *10',description:'',category:'قسم المواد السفري',price:1600,image:'',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69455e7341f361964753e582',name:'ماء بطل الرحمة *330 مل',description:'',category:'قسم المياه',price:250,image:'assets/products/69455e7341f361964753e582.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6907270b41f3619647ffaa2b',name:'ماء اكوافينا زجاجي * 750 مل',description:'',category:'قسم المياه',price:1000,image:'assets/products/6907270b41f3619647ffaa2b.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'68da848041f361964709ea08',name:'ماء منى قدح',description:'',category:'قسم المياه',price:2250,image:'assets/products/68da848041f361964709ea08.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'68da847d41f361964709dd1e',name:'ماء دبه منى',description:'',category:'قسم المياه',price:2250,image:'assets/products/68da847d41f361964709dd1e.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69ee2d8e5201e3af18656e9b',name:'منفاخ هواء',description:'',category:'قسم الورقيات',price:3500,image:'assets/products/69ee2d8e5201e3af18656e9b.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69ee2d8e5201e3af18656e95',name:'مسبح قياس 1.47*33  ملون',description:'',category:'قسم الورقيات',price:15500,image:'assets/products/69ee2d8e5201e3af18656e95.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69ee2d8e5201e3af18656e8f',name:'مسبح قياس 1.47*33 شفاف',description:'',category:'قسم الورقيات',price:15500,image:'assets/products/69ee2d8e5201e3af18656e8f.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69ee2d8e5201e3af18656e77',name:'مسبح شفاف قياس 1.47*33',description:'',category:'قسم الورقيات',price:11500,image:'assets/products/69ee2d8e5201e3af18656e77.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a21682813c8bd65daa7e893',name:'حليب نوفالاك اي دي * 600 غراكم',description:'',category:'قسم حليب ومستلزمات الاطفال',price:26400,image:'assets/products/6a21682813c8bd65daa7e893.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a21682813c8bd65daa7e88d',name:'حليب نوفالاك اي تي 3 * 800 غرام',description:'',category:'قسم حليب ومستلزمات الاطفال',price:29600,image:'assets/products/6a21682813c8bd65daa7e88d.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a21682813c8bd65daa7e887',name:'حليب نوفالاك اي تي 2 * 400 غرام',description:'',category:'قسم حليب ومستلزمات الاطفال',price:15900,image:'assets/products/6a21682813c8bd65daa7e887.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a21682813c8bd65daa7e881',name:'حليب نوفالاك اي تي 1 * 400غرام',description:'',category:'قسم حليب ومستلزمات الاطفال',price:15900,image:'assets/products/6a21682813c8bd65daa7e881.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69a1902cc71cd2514cb1058a',name:'بسكت كولون خالي من الكلوتين *300 غرام',description:'',category:'قسم مواد خالية من الغلوتين',price:4650,image:'assets/products/69a1902cc71cd2514cb1058a.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69a1902cc71cd2514cb10584',name:'بسكت كولون خالي من الكلوتين *400 غارام',description:'',category:'قسم مواد خالية من الغلوتين',price:5600,image:'assets/products/69a1902cc71cd2514cb10584.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69a1902cc71cd2514cb10554',name:'كورن فلكس خالي من الكلوتين * 250 غرام',description:'',category:'قسم مواد خالية من الغلوتين',price:6750,image:'assets/products/69a1902cc71cd2514cb10554.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69a1902bc71cd2514cb1053c',name:'كريمة طبخ ايطالية خالية من الكلوتين * 200 غرام',description:'',category:'قسم مواد خالية من الغلوتين',price:2000,image:'assets/products/69a1902bc71cd2514cb1053c.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69f1c2d75201e3af1872d881',name:'جبس دوريتوس وحش التغميس حار وحلو * 200 غرام',description:'',category:'كيك و معجنات',price:1400,image:'assets/products/69f1c2d75201e3af1872d881.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6984db51c71cd2514ce11f7c',name:'حلاوة جزرية باب الاغا',description:'',category:'كيك و معجنات',price:3000,image:'assets/products/6984db51c71cd2514ce11f7c.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69455e7341f361964753e5bf',name:'بقلاوة مخابز بابل',description:'',category:'كيك و معجنات',price:1250,image:'assets/products/69455e7341f361964753e5bf.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69455e7141f361964753df5d',name:'الزيتون سلايني',description:'',category:'كيك و معجنات',price:2500,image:'assets/products/69455e7141f361964753df5d.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69c7f4e472b30d43d93584e1',name:'عرض العيد خبز صاج التركي',description:'',category:'مخبوزات',price:1000,image:'assets/products/69c7f4e472b30d43d93584e1.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a11b5c913c8bd65da511cb0',name:'خبز بذور الكتان جوهرة لبنان',description:'',category:'مخبوزات',price:1500,image:'',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a11b5c813c8bd65da511caa',name:'خبز الذرة جوهرة لبنان',description:'',category:'مخبوزات',price:1500,image:'',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a11b5c813c8bd65da511ca4',name:'خبز شوفان قمح بغداد',description:'',category:'مخبوزات',price:1100,image:'',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a228fd713c8bd65daabc02e',name:'نفاخ ذهبي قلب',description:'',category:'مستلزمات اعياد ميلاد ومناسبات',price:900,image:'',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a228fd713c8bd65daabc028',name:'نضارة + طاق عيد ميلاد',description:'',category:'مستلزمات اعياد ميلاد ومناسبات',price:1250,image:'',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a228fd713c8bd65daabc022',name:'شمع الوان معطر *8',description:'',category:'مستلزمات اعياد ميلاد ومناسبات',price:1250,image:'',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a228fd713c8bd65daabc01c',name:'شمع الحب',description:'',category:'مستلزمات اعياد ميلاد ومناسبات',price:900,image:'',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6949966c41f3619647d3934b',name:'مشروب طاقة ريد بل زيرو * 250 مل',description:'',category:'مشروبات الطاقة',price:2750,image:'assets/products/6949966c41f3619647d3934b.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6949964141f3619647d31a74',name:'مشروب طاقة ريد بول دايت *250 مل',description:'',category:'مشروبات الطاقة',price:2500,image:'assets/products/6949964141f3619647d31a74.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69455e6e41f361964753d616',name:'مشروب طاقة ستينج زجاجي',description:'',category:'مشروبات الطاقة',price:500,image:'assets/products/69455e6e41f361964753d616.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69455e6d41f361964753d1fb',name:'مشروب طاقة ريد بول ازرق * 250 مل',description:'',category:'مشروبات الطاقة',price:1750,image:'assets/products/69455e6d41f361964753d1fb.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a11b5bf13c8bd65da511a44',name:'معكرونة جوكر * 2 كيلو',description:'',category:'معكرونية وشوربة جاهزة',price:2400,image:'assets/products/6a11b5bf13c8bd65da511a44.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a086195de01713c1127784f',name:'نودلز ابو جنة * 70 غرام',description:'',category:'معكرونية وشوربة جاهزة',price:250,image:'assets/products/6a086195de01713c1127784f.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69a1903dc71cd2514cb1082f',name:'معكرونة باستازارا الايطالية * 500 غرام',description:'',category:'معكرونية وشوربة جاهزة',price:1850,image:'assets/products/69a1903dc71cd2514cb1082f.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69a1903dc71cd2514cb10829',name:'معكرونة برنتي الايطالية',description:'',category:'معكرونية وشوربة جاهزة',price:950,image:'assets/products/69a1903dc71cd2514cb10829.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69de30db539c5ebf3fe85919',name:'كبة تبسي * 8 الورد البغدادي',description:'',category:'منتجات الورد البغدادي',price:4500,image:'assets/products/69de30db539c5ebf3fe85919.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69de30db539c5ebf3fe85913',name:'بورك طويل لحم * 8 الورد البغدادي',description:'',category:'منتجات الورد البغدادي',price:5000,image:'assets/products/69de30db539c5ebf3fe85913.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69de30db539c5ebf3fe8590d',name:'بورك مثلث لحم الورد البغدادي *8',description:'',category:'منتجات الورد البغدادي',price:5000,image:'assets/products/69de30db539c5ebf3fe8590d.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69de30db539c5ebf3fe858ef',name:'بركر دجاج * 10 الورد البغدادي',description:'',category:'منتجات الورد البغدادي',price:5000,image:'assets/products/69de30db539c5ebf3fe858ef.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a1a9c1813c8bd65da884e3e',name:'ورك دجاج البوادي * 2 كيلو',description:'',category:'منتجات شركة البوادي',price:5500,image:'assets/products/6a1a9c1813c8bd65da884e3e.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'6a08619ade01713c1127823f',name:'عصا الطبل البوادي * 1 كيلو',description:'',category:'منتجات شركة البوادي',price:6000,image:'assets/products/6a08619ade01713c1127823f.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69c8c7f672b30d43d9396007',name:'لحم دجاج مفروم   500غرام',description:'',category:'منتجات شركة البوادي',price:1750,image:'assets/products/69c8c7f672b30d43d9396007.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69c8c7f672b30d43d9396001',name:'نقانق دجاج بالجبنة البوادي  * 340 غرام',description:'',category:'منتجات شركة البوادي',price:1150,image:'assets/products/69c8c7f672b30d43d9396001.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69afee73c71cd2514cfda188',name:'توست الريف اسمر ببذور الكتان والشوفان',description:'',category:'منتجات مخابز الريف',price:3350,image:'assets/products/69afee73c71cd2514cfda188.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69afee73c71cd2514cfda182',name:'توست الريف بدقيق البطاطا',description:'',category:'منتجات مخابز الريف',price:3350,image:'assets/products/69afee73c71cd2514cfda182.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69afee73c71cd2514cfda176',name:'صمون الريف ببذور الشيا ونخالة القمح',description:'',category:'منتجات مخابز الريف',price:3150,image:'assets/products/69afee73c71cd2514cfda176.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
  {id:'69afee73c71cd2514cfda169',name:'خبز بذور الكتان الريف',description:'',category:'منتجات مخابز الريف',price:2500,image:'assets/products/69afee73c71cd2514cfda169.jpg',inStock:true,addons:[],isSpecial:false,salesCount:0},
];

// ─── Local Cache ─────────────────────────────────────────────
let _menuCache = [...FALLBACK_MENU];
let _ordersCache = [];

// ─── localStorage Persistence ────────────────────────────────
const MENU_STORAGE_KEY = 'kafeel_menu_cache';
const MENU_CACHE_TTL = 60 * 1000;

function loadMenuFromStorage() {
  try {
    const raw = localStorage.getItem(MENU_STORAGE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (cached && cached.data && cached.data.length > 0) {
      return cached;
    }
  } catch (e) {}
  return null;
}

function saveMenuToStorage(data) {
  try {
    localStorage.setItem(MENU_STORAGE_KEY, JSON.stringify({
      data: data,
      ts: Date.now(),
    }));
  } catch (e) {}
}

(function () {
  const stored = loadMenuFromStorage();
  if (stored && stored.data) {
    _menuCache = stored.data;
  }
})();

// ─── Data Transform Helpers ─────────────────────────────────

function transformMenuItem(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    category: row.category,
    price: row.price,
    image: row.image || '',
    inStock: row.in_stock,
    addons: row.addons || [],
    isSpecial: row.is_special || false,
    salesCount: row.sales_count || 0,
    offerPrice: row.offer_price || null,
  };
}

function transformOrder(row) {
  return {
    id: row.id,
    phone: row.phone,
    address: row.address,
    name: row.customer_name,
    items: (row.order_items || []).map(function (item) {
      return {
        name: item.item_name,
        qty: item.qty,
        unitPrice: item.unit_price,
        addons: item.addons || [],
        notes: item.notes || '',
      };
    }),
    subtotal: row.subtotal,
    deliveryFee: row.delivery_fee,
    discount: row.discount,
    total: row.total,
    status: row.status,
    timestamp: new Date(row.created_at).getTime(),
  };
}

// ─── Menu Functions ──────────────────────────────────────────

async function getMenu() {
  const stored = loadMenuFromStorage();
  const isFresh = stored && (Date.now() - stored.ts) < MENU_CACHE_TTL;

  if (isFresh) {
    _menuCache = stored.data;
    return stored.data;
  }

  try {
    const { data, error } = await _supabase
      .from('menu_items')
      .select('*')
      .order('sort_order', { ascending: true });

    if (!error && data && data.length > 0) {
      const menu = data.map(transformMenuItem);
      _menuCache = menu;
      saveMenuToStorage(menu);
      return menu;
    }
  } catch (err) {
    console.warn('getMenu failed:', err);
  }
  return _menuCache;
}

async function toggleStock(itemId, inStock) {
  const { error } = await _supabase
    .from('menu_items')
    .update({ in_stock: inStock })
    .eq('id', itemId);

  if (!error) {
    _menuCache = _menuCache.map(function (item) {
      if (item.id === itemId) return Object.assign({}, item, { inStock: inStock });
      return item;
    });
    saveMenuToStorage(_menuCache);
  }
  return { success: !error };
}

async function toggleSpecial(itemId, isSpecial) {
  const { error } = await _supabase
    .from('menu_items')
    .update({ is_special: isSpecial })
    .eq('id', itemId);

  if (!error) {
    _menuCache = _menuCache.map(function (item) {
      if (item.id === itemId) return Object.assign({}, item, { isSpecial: isSpecial });
      return item;
    });
    saveMenuToStorage(_menuCache);
  }
  return { success: !error };
}

async function updateMenuItem(itemId, updates) {
  const dbUpdates = {};
  if (updates.name !== undefined) dbUpdates.name = updates.name;
  if (updates.price !== undefined) dbUpdates.price = updates.price;
  if (updates.description !== undefined) dbUpdates.description = updates.description;
  if (updates.category !== undefined) dbUpdates.category = updates.category;
  if (updates.image !== undefined) dbUpdates.image = updates.image;
  // offerPrice: a positive number sets the discount; null/0 clears it
  if (updates.offerPrice !== undefined) dbUpdates.offer_price = (updates.offerPrice && updates.offerPrice > 0) ? updates.offerPrice : null;

  const { error } = await _supabase
    .from('menu_items')
    .update(dbUpdates)
    .eq('id', itemId);

  if (!error) {
    _menuCache = _menuCache.map(function (item) {
      if (item.id === itemId) return Object.assign({}, item, updates);
      return item;
    });
    saveMenuToStorage(_menuCache);
  }
  return { success: !error };
}

async function deleteMenuItem(itemId) {
  const { error } = await _supabase
    .from('menu_items')
    .delete()
    .eq('id', itemId);
  if (!error) {
    _menuCache = _menuCache.filter(function (item) { return item.id !== itemId; });
    saveMenuToStorage(_menuCache);
  }
  return { success: !error };
}

// Upload a product photo to Supabase Storage; returns its public URL.
const PRODUCT_BUCKET = 'product-images';
async function uploadProductImage(file) {
  if (!file) return { success: true, url: '' };
  try {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = 'products/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    const { error } = await _supabase.storage.from(PRODUCT_BUCKET).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'image/jpeg',
    });
    if (error) return { success: false, error: error.message };
    const { data } = _supabase.storage.from(PRODUCT_BUCKET).getPublicUrl(path);
    return { success: true, url: (data && data.publicUrl) || '' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Create a new product. id is auto-generated; admin auth enforced by RLS.
async function createMenuItem(item) {
  const id = 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const row = {
    id: id,
    name: item.name,
    description: item.description || '',
    category: item.category,
    price: item.price,
    image: item.image || '',
    in_stock: true,
    addons: [],
    is_special: false,
    sales_count: 0,
    sort_order: 9999,
  };
  const { error } = await _supabase.from('menu_items').insert(row);
  if (error) return { success: false, error: error.message };
  _menuCache = _menuCache.concat([transformMenuItem(row)]);
  saveMenuToStorage(_menuCache);
  return { success: true, id: id };
}

function invalidateMenuCache() {
  localStorage.removeItem(MENU_STORAGE_KEY);
}

// ─── Sections / Categories (admin-managed) ──────────────────
function transformCategory(row) {
  return { id: row.id, name: row.name, image: row.image || '', sortOrder: row.sort_order || 0 };
}

async function getCategories() {
  try {
    const { data, error } = await _supabase
      .from('categories')
      .select('*')
      .order('sort_order', { ascending: true });
    if (!error && data) return data.map(transformCategory);
  } catch (e) { console.warn('getCategories failed:', e); }
  return [];
}

async function createCategory(name, image, sortOrder) {
  const { data, error } = await _supabase
    .from('categories')
    .insert({ name: name, image: image || '', sort_order: sortOrder || 999 })
    .select()
    .single();
  if (error) return { success: false, error: error.message };
  return { success: true, category: transformCategory(data) };
}

// Update a section's image and/or sort order (name uses renameCategory).
async function updateCategory(id, updates) {
  const dbUpdates = {};
  if (updates.image !== undefined) dbUpdates.image = updates.image;
  if (updates.sortOrder !== undefined) dbUpdates.sort_order = updates.sortOrder;
  const { error } = await _supabase.from('categories').update(dbUpdates).eq('id', id);
  return { success: !error, error: error && error.message };
}

// Rename a section + cascade to its products (atomic RPC).
async function renameCategory(id, newName) {
  const { error } = await _supabase.rpc('admin_rename_category', { p_id: id, p_new: newName });
  if (error) {
    const code = (error.message || '').split(':')[0];
    const msg = code.includes('name_taken') ? 'الاسم مستخدم بالفعل'
              : code.includes('invalid_name') ? 'اسم غير صالح' : 'تعذّر تعديل القسم';
    return { success: false, error: msg };
  }
  return { success: true };
}

// Delete a section AND all its products (atomic RPC).
async function deleteCategory(id) {
  const { error } = await _supabase.rpc('admin_delete_category', { p_id: id });
  return { success: !error, error: error && error.message };
}

let _categoriesChannel = null;
function subscribeToCategories(callback) {
  if (_categoriesChannel) { _supabase.removeChannel(_categoriesChannel); }
  _categoriesChannel = _supabase
    .channel('categories-updates')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, function () { callback(); })
    .subscribe();
}

async function fetchMenuFresh() {
  invalidateMenuCache();
  try {
    const { data, error } = await _supabase
      .from('menu_items')
      .select('*')
      .order('sort_order', { ascending: true });

    if (!error && data && data.length > 0) {
      const menu = data.map(transformMenuItem);
      _menuCache = menu;
      saveMenuToStorage(menu);
      return menu;
    }
  } catch (err) {
    console.warn('fetchMenuFresh failed:', err);
  }
  return _menuCache;
}

// ─── Orders Functions ────────────────────────────────────────

async function getOrders() {
  try {
    const { data, error } = await _supabase
      .from('orders')
      .select('*, order_items(*)')
      .in('status', ['pending', 'cooking', 'delivery'])
      .order('created_at', { ascending: true });

    if (!error && data) {
      const orders = data.map(transformOrder);
      _ordersCache = orders;
      return orders;
    }
  } catch (err) {
    console.warn('getOrders failed:', err);
  }
  return _ordersCache;
}

async function saveOrder(orderData) {
  try {
    var { data, error } = await _supabase.rpc('create_order', {
      p_customer_name: orderData.name || '',
      p_phone: orderData.phone,
      p_address: orderData.address,
      p_items: orderData.items,
      p_promo_code: orderData.promoCode || null,
      p_session_token: getCustomerToken(),
    });

    if (error) {
      console.error('saveOrder RPC failed:', error);
      return { success: false, error: error.message };
    }

    // Store access token for secure order lookups
    if (data && data.access_token) {
      try { localStorage.setItem('kafeel_order_token_' + data.id, data.access_token); } catch (e) {}
    }

    return { success: true, data: data };
  } catch (err) {
    console.error('saveOrder exception:', err);
    return { success: false, error: err.message };
  }
}

async function updateOrder(orderId, status) {
  const { error } = await _supabase
    .from('orders')
    .update({ status: status })
    .eq('id', orderId);
  return { success: !error };
}

async function getCompletedOrders() {
  try {
    const { data, error } = await _supabase
      .from('orders')
      .select('*, order_items(*)')
      .in('status', ['done', 'cancelled'])
      .order('created_at', { ascending: false });

    if (!error && data) {
      return data.map(transformOrder);
    }
  } catch (err) {
    console.warn('getCompletedOrders failed:', err);
  }
  return [];
}

async function getOrderStatus(orderId) {
  var result = await getOrderStatusFull(orderId);
  return result.status === 'not_found' ? null : result.status;
}

async function getOrderStatusFull(orderId) {
  // Try secure RPC first (orders created with access_token)
  try {
    var token = localStorage.getItem('kafeel_order_token_' + orderId);
    if (token) {
      var rpcResult = await _supabase.rpc('get_order_status', {
        p_order_id: orderId,
        p_access_token: token,
      });
      if (!rpcResult.error && rpcResult.data && rpcResult.data.status !== 'not_found') {
        return {
          status: rpcResult.data.status,
          cancelNote: rpcResult.data.cancel_note || '',
        };
      }
    }
  } catch (e) {}

  // Fallback: direct query (old orders without access_token)
  try {
    var directResult = await _supabase
      .from('orders')
      .select('status, cancel_note')
      .eq('id', orderId)
      .single();

    if (!directResult.error && directResult.data) {
      return {
        status: directResult.data.status,
        cancelNote: directResult.data.cancel_note || '',
      };
    }
  } catch (err) {
    console.warn('getOrderStatusFull failed:', err);
  }
  return { status: 'not_found' };
}

async function declineOrder(orderId, note) {
  const { error } = await _supabase
    .from('orders')
    .update({ status: 'cancelled', cancel_note: note || '' })
    .eq('id', orderId);
  return { success: !error };
}

async function clearCompletedOrders() {
  const { error } = await _supabase
    .from('orders')
    .delete()
    .in('status', ['done', 'cancelled']);
  return { success: !error };
}

// ─── Promo Code Functions ────────────────────────────────────

async function validatePromoCode(code) {
  try {
    const { data, error } = await _supabase
      .from('promo_codes')
      .select('code, type, value')
      .eq('code', code)
      .eq('active', true)
      .single();

    if (!error && data) {
      return { code: data.code, type: data.type, value: data.value };
    }
  } catch (err) {
    console.warn('validatePromo failed:', err);
  }
  return null;
}

// ─── Restaurant Status ──────────────────────────────────────

async function getRestaurantStatus() {
  try {
    const { data, error } = await _supabase
      .from('settings')
      .select('value')
      .eq('key', 'restaurant_status')
      .single();

    if (!error && data) {
      return { success: true, isOpen: data.value.isOpen };
    }
  } catch (err) {
    console.warn('getRestaurantStatus failed:', err);
  }
  return { success: true, isOpen: true };
}

async function setRestaurantStatus(isOpen) {
  const { error } = await _supabase
    .from('settings')
    .update({ value: { isOpen: isOpen } })
    .eq('key', 'restaurant_status');
  return { success: !error };
}

// ─── Customer Authentication (phone + password) ─────────────
// Passwords are verified server-side (bcrypt) via SECURITY DEFINER RPCs in
// customer-auth.sql. The client only ever holds an opaque session token.
const CUSTOMER_TOKEN_KEY = 'kafeel_customer_token';

function getCustomerToken() {
  try { return localStorage.getItem(CUSTOMER_TOKEN_KEY); } catch (e) { return null; }
}
function setCustomerToken(token) {
  try { token ? localStorage.setItem(CUSTOMER_TOKEN_KEY, token) : localStorage.removeItem(CUSTOMER_TOKEN_KEY); } catch (e) {}
}

// Normalize an Iraqi mobile number to canonical +9647XXXXXXXX.
// Accepts 07XXXXXXXXX, 7XXXXXXXXX, 9647..., +9647... Returns null if invalid.
function normalizeIraqiPhone(input) {
  if (!input) return null;
  let d = String(input).replace(/[^\d]/g, '');      // keep digits only
  if (d.indexOf('00964') === 0) d = d.slice(5);
  else if (d.indexOf('964') === 0) d = d.slice(3);
  if (d.indexOf('0') === 0) d = d.slice(1);          // drop trunk 0
  const candidate = '+964' + d;
  return /^\+9647[578]\d{8}$/.test(candidate) ? candidate : null;
}

// Friendly Arabic messages for server error codes.
const AUTH_ERRORS = {
  invalid_username: 'اسم المستخدم غير صالح (3-30 حرفاً)',
  invalid_phone: 'رقم الهاتف غير صالح. مثال: 07XX XXX XXXX',
  weak_password: 'كلمة المرور قصيرة جداً (6 أحرف على الأقل)',
  username_taken: 'اسم المستخدم مستخدم بالفعل',
  phone_taken: 'رقم الهاتف مسجّل بالفعل',
  invalid_credentials: 'بيانات الدخول غير صحيحة',
  otp_required: 'مطلوب رمز تحقق (سيتوفر عبر واتساب قريباً)',
  auth_required: 'يجب تسجيل الدخول لإتمام الطلب',
};
function authMessage(err) {
  const raw = (err && (err.message || err)) ? String(err.message || err) : '';
  const code = raw.split(':')[0].trim();
  return AUTH_ERRORS[code] || 'حدث خطأ، يرجى المحاولة مرة أخرى';
}

async function registerCustomer(username, phone, password) {
  const canonical = normalizeIraqiPhone(phone);
  if (!canonical) return { success: false, error: AUTH_ERRORS.invalid_phone };
  try {
    const { data, error } = await _supabase.rpc('customer_register', {
      p_username: username,
      p_phone: canonical,
      p_password: password,
    });
    if (error) return { success: false, error: authMessage(error) };
    if (data && data.token) setCustomerToken(data.token);
    return { success: true, customer: data };
  } catch (err) {
    return { success: false, error: authMessage(err) };
  }
}

async function loginCustomer(identifier, password) {
  // If the identifier looks like a phone, normalize it; otherwise treat as username.
  let id = String(identifier || '').trim();
  const asPhone = normalizeIraqiPhone(id);
  if (asPhone) id = asPhone;
  try {
    const { data, error } = await _supabase.rpc('customer_login', {
      p_identifier: id,
      p_password: password,
    });
    if (error) return { success: false, error: authMessage(error) };
    if (data && data.token) setCustomerToken(data.token);
    return { success: true, customer: data };
  } catch (err) {
    return { success: false, error: authMessage(err) };
  }
}

async function getCustomerSession() {
  const token = getCustomerToken();
  if (!token) return null;
  try {
    const { data, error } = await _supabase.rpc('customer_me', { p_token: token });
    if (error || !data || !data.valid) { setCustomerToken(null); return null; }
    return { username: data.username, phone: data.phone };
  } catch (err) {
    return null;
  }
}

async function logoutCustomer() {
  const token = getCustomerToken();
  if (token) { try { await _supabase.rpc('customer_logout', { p_token: token }); } catch (e) {} }
  setCustomerToken(null);
}

async function resetCustomerPassword(phone, otp, newPassword) {
  const canonical = normalizeIraqiPhone(phone);
  if (!canonical) return { success: false, error: AUTH_ERRORS.invalid_phone };
  try {
    const { data, error } = await _supabase.rpc('customer_reset_password', {
      p_phone: canonical,
      p_otp: otp || '',
      p_new_password: newPassword,
    });
    if (error) return { success: false, error: authMessage(error) };
    return { success: true };
  } catch (err) {
    return { success: false, error: authMessage(err) };
  }
}

// ─── Admin Authentication ───────────────────────────────────

async function adminLogin(email, password) {
  try {
    const { data, error } = await _supabase.auth.signInWithPassword({
      email: email,
      password: password,
    });

    if (error) {
      console.warn('Admin login failed:', error.message);
      return { success: false };
    }

    return { success: true };
  } catch (err) {
    console.warn('Admin login exception:', err);
    return { success: false };
  }
}

async function adminLogout() {
  await _supabase.auth.signOut();
}

async function isAdminLoggedIn() {
  const { data } = await _supabase.auth.getSession();
  return !!(data && data.session);
}

// ─── Realtime Subscriptions ─────────────────────────────────

let _orderChannel = null;
let _ordersChannel = null;
let _menuChannel = null;

function subscribeToOrder(orderId, callback) {
  unsubscribeFromOrder();
  _orderChannel = _supabase
    .channel('order-tracking-' + orderId)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'orders', filter: 'id=eq.' + orderId },
      function (payload) {
        if (payload.new) {
          callback({
            status: payload.new.status,
            cancelNote: payload.new.cancel_note || '',
          });
        }
      }
    )
    .subscribe();
}

function unsubscribeFromOrder() {
  if (_orderChannel) {
    _supabase.removeChannel(_orderChannel);
    _orderChannel = null;
  }
}

function subscribeToOrders(callback) {
  unsubscribeFromOrders();
  _ordersChannel = _supabase
    .channel('admin-orders')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'orders' },
      function () {
        callback();
      }
    )
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'order_items' },
      function () {
        callback();
      }
    )
    .subscribe();
}

function unsubscribeFromOrders() {
  if (_ordersChannel) {
    _supabase.removeChannel(_ordersChannel);
    _ordersChannel = null;
  }
}

function subscribeToMenu(callback) {
  if (_menuChannel) {
    _supabase.removeChannel(_menuChannel);
  }
  _menuChannel = _supabase
    .channel('menu-updates')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'menu_items' },
      function () {
        callback();
      }
    )
    .subscribe();
}

// ─── Offers Functions ───────────────────────────────────────

async function getActiveOffers() {
  try {
    const { data, error } = await _supabase
      .from('offers')
      .select('*')
      .eq('is_active', true)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (!error && data) {
      return data.map(function (offer) {
        return {
          id: offer.id,
          title: offer.title,
          price: offer.price,
          itemIds: offer.item_ids,
          expiresAt: offer.expires_at,
          isActive: offer.is_active,
        };
      });
    }
  } catch (err) {
    console.warn('getActiveOffers failed:', err);
  }
  return [];
}

async function getAllOffers() {
  try {
    const { data, error } = await _supabase
      .from('offers')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      return data.map(function (offer) {
        return {
          id: offer.id,
          title: offer.title,
          price: offer.price,
          itemIds: offer.item_ids,
          expiresAt: offer.expires_at,
          isActive: offer.is_active,
          createdAt: offer.created_at,
        };
      });
    }
  } catch (err) {
    console.warn('getAllOffers failed:', err);
  }
  return [];
}

async function createOffer(title, price, itemIds, expiresAt) {
  const { data, error } = await _supabase
    .from('offers')
    .insert({
      title: title,
      price: price,
      item_ids: itemIds,
      expires_at: expiresAt,
      is_active: true,
    })
    .select()
    .single();

  return { success: !error, data: data, error: error };
}

async function deleteOffer(offerId) {
  const { error } = await _supabase
    .from('offers')
    .delete()
    .eq('id', offerId);

  return { success: !error };
}

async function toggleOfferActive(offerId, isActive) {
  const { error } = await _supabase
    .from('offers')
    .update({ is_active: isActive })
    .eq('id', offerId);

  return { success: !error };
}

let _offersChannel = null;

function subscribeToOffers(callback) {
  if (_offersChannel) {
    _supabase.removeChannel(_offersChannel);
  }
  _offersChannel = _supabase
    .channel('offers-updates')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'offers' },
      function () { callback(); }
    )
    .subscribe();
}

// ─── Push Notification (Edge Function) ──────────────────────

async function sendPushNotification(orderId, status) {
  try {
    const { data, error } = await _supabase.functions.invoke('send-notification', {
      body: { orderId, status },
    });
    if (error) {
      console.error('Push notification error:', error);
    } else {
      console.log('Push notification sent:', data);
    }
  } catch (err) {
    console.error('Push notification exception:', err);
  }
}

// ─── Utility Functions ───────────────────────────────────────

function formatPrice(amount) {
  return amount.toLocaleString('ar-IQ') + ' د.ع';
}

function generateOrderId() {
  var uuid = crypto.randomUUID().replace(/-/g, '').substring(0, 12).toUpperCase();
  return 'ORD-' + uuid;
}

function getTimeString(timestamp) {
  const d = new Date(timestamp);
  return d.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' });
}

function getDateString(timestamp) {
  const d = new Date(timestamp);
  return d.toLocaleDateString('ar-IQ', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Iraqi mobile number, local format only (no +964 / no leading country code):
// 11 digits, starts with 07 then a carrier digit — Korek 075, Asiacell 077/078,
// Zain 078/079. e.g. 0770xxxxxxx
const PHONE_REGEX = /^07[5789]\d{8}$/;
function validatePhone(phone) {
  return PHONE_REGEX.test(String(phone || '').replace(/[^\d]/g, ''));
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
