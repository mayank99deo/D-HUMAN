// Hinglish as hi-IN speech recognition writes it, and as a Hinglish texter would write it
// back (2026-11-22). Since Hinglish listens in hi-IN again, every spoken Hinglish meal and Ask
// question arrives in Devanagari, and romanize() (lib/domain/romanize.ts) puts it in Latin
// letters before anyone sees it. This is the corpus that says whether it reads naturally.
//
// How the transcripts are written: the way hi-IN dictation writes speech, as far as we know it
// without a real iPhone. English food and gym words in Devanagari ("चिकन ब्रेस्ट"), numbers
// both as digits ("200 ग्राम") and as words ("दो सौ ग्राम"), fractions as words (डेढ़,
// ढाई, आधा, सवा, साढ़े, पाव), little punctuation, and a few English words passed through
// in Latin letters. Which of these forms a real iPhone writes is unconfirmed: see `form`.
//
// `want` is what a Hinglish texter expects. A token with "|" accepts any of its spellings
// ("sabji|sabzi"); case and trailing punctuation don't count. The score is in
// scripts/romanize-eval.mts; tests/romanize.test.ts holds every case to it.

export type Transcript = {
  id: string;
  kind: "meal" | "ask";
  /** What hi-IN would write. */
  hi: string;
  /** What a Hinglish texter would write. */
  want: string;
  /** How numbers and English words are written, so a real iPhone's output can be matched to a row. */
  form?: "digits" | "number words" | "fraction words" | "latin mixed" | "devanagari digits";
  note?: string;
};

export const TRANSCRIPTS: Transcript[] = [
  // ── Mayank's bug reports, 2026-11-22 (en-IN wrote "towel or chicken" and "Dosa gram") ──
  { id: "m-bug-300", kind: "meal", hi: "300 ग्राम चावल और चिकन", want: "300 gram chawal aur chicken", form: "digits", note: "en-IN: '300 g towel or chicken'" },
  { id: "m-bug-dosa", kind: "meal", hi: "एक कटोरी दाल और दो सौ ग्राम चावल", want: "ek katori dal aur do sau gram chawal", form: "number words", note: "en-IN: 'Dosa gram chawal'" },
  { id: "m-bug-200", kind: "meal", hi: "200 ग्राम चावल", want: "200 gram chawal", form: "digits", note: "en-IN: 'do so gram'" },
  { id: "m-bug-200w", kind: "meal", hi: "दो सौ ग्राम चावल", want: "do sau gram chawal", form: "number words" },

  // ── Numbers and units ──
  { id: "m-paneer-200", kind: "meal", hi: "200 ग्राम पनीर की सब्जी और दो रोटी", want: "200 gram paneer ki sabji|sabzi aur do roti", form: "digits" },
  { id: "m-dhai-sau", kind: "meal", hi: "ढाई सौ ग्राम चिकन ब्रेस्ट", want: "dhai sau gram chicken breast", form: "fraction words" },
  { id: "m-dedh-katori", kind: "meal", hi: "डेढ़ कटोरी राजमा चावल", want: "dedh katori rajma chawal", form: "fraction words" },
  { id: "m-dedh-sau", kind: "meal", hi: "डेढ़ सौ ग्राम पनीर", want: "dedh sau gram paneer", form: "fraction words" },
  { id: "m-teen-sau", kind: "meal", hi: "तीन सौ ग्राम चावल और चिकन", want: "teen sau gram chawal aur chicken", form: "number words" },
  { id: "m-aadha-cup", kind: "meal", hi: "आधा कप ओट्स दूध के साथ", want: "aadha|adha cup oats doodh ke saath", form: "fraction words" },
  { id: "m-aadha-kilo", kind: "meal", hi: "आधा किलो दही", want: "aadha|adha kilo dahi", form: "fraction words" },
  { id: "m-paav-kilo", kind: "meal", hi: "पाव किलो चिकन", want: "paav|pav kilo chicken", form: "fraction words", note: "पाव as a quarter" },
  { id: "m-sawa-sau", kind: "meal", hi: "सवा सौ ग्राम पनीर", want: "sawa|sava sau gram paneer", form: "fraction words" },
  { id: "m-sadhe", kind: "meal", hi: "साढ़े तीन सौ एमएल दूध", want: "sadhe teen sau ml doodh", form: "fraction words" },
  { id: "m-ml-digits", kind: "meal", hi: "250 एमएल दूध", want: "250 ml doodh", form: "digits" },
  { id: "m-ml-spaced", kind: "meal", hi: "300 एम एल छाछ", want: "300 ml chhachh", form: "digits", note: "the letters said one by one" },
  { id: "m-litre", kind: "meal", hi: "एक लीटर पानी", want: "ek litre|liter pani|paani" },
  { id: "m-scoop", kind: "meal", hi: "एक स्कूप व्हे प्रोटीन पानी में", want: "ek scoop whey protein pani|paani mein" },
  { id: "m-creatine", kind: "meal", hi: "पांच ग्राम क्रिएटिन", want: "paanch|panch gram creatine", form: "number words" },
  { id: "m-creatine-5", kind: "meal", hi: "5 ग्राम क्रिएटिन पानी के साथ", want: "5 gram creatine pani|paani ke saath", form: "digits" },
  { id: "m-chammach", kind: "meal", hi: "एक चम्मच घी", want: "ek chammach|chamach ghee|ghi" },
  { id: "m-chammach-pb", kind: "meal", hi: "दो चम्मच पीनट बटर", want: "do chammach|chamach peanut butter" },
  { id: "m-badam", kind: "meal", hi: "दस बादाम और पांच अखरोट", want: "das badam aur paanch|panch akhrot", form: "number words" },
  { id: "m-dev-digits", kind: "meal", hi: "२०० ग्राम चावल", want: "200 gram chawal", form: "devanagari digits" },
  { id: "m-mutthi", kind: "meal", hi: "एक मुट्ठी भुने चने", want: "ek mutthi bhune chane" },
  { id: "m-grams", kind: "meal", hi: "150 ग्राम्स चिकन", want: "150 grams chicken", form: "digits" },
  { id: "m-kg", kind: "meal", hi: "एक केजी चिकन चार लोगों में", want: "ek kg chicken chaar logon mein" },

  // ── English food and gym words, as hi-IN writes them ──
  { id: "m-boiled", kind: "meal", hi: "दो बॉयल्ड एग और एक ब्लैक कॉफी", want: "do boiled egg aur ek black coffee" },
  { id: "m-uble", kind: "meal", hi: "तीन उबले अंडे", want: "teen uble ande" },
  { id: "m-bhurji", kind: "meal", hi: "दो अंडे की भुर्जी और दो ब्रेड", want: "do ande ki bhurji aur do bread" },
  { id: "m-omelette", kind: "meal", hi: "ऑमलेट दो अंडे का", want: "omelette|omelet do ande ka" },
  { id: "m-salad", kind: "meal", hi: "एक बाउल सलाद", want: "ek bowl salad" },
  { id: "m-grilled", kind: "meal", hi: "ग्रिल्ड चिकन सलाद", want: "grilled chicken salad" },
  { id: "m-pb-sandwich", kind: "meal", hi: "पीनट बटर सैंडविच", want: "peanut butter sandwich" },
  { id: "m-brown-bread", kind: "meal", hi: "दो स्लाइस ब्राउन ब्रेड पर पीनट बटर", want: "do slice brown bread par peanut butter" },
  { id: "m-burger", kind: "meal", hi: "एक चिकन बर्गर और फ्रेंच फ्राइज़", want: "ek chicken burger aur french fries" },
  { id: "m-pizza", kind: "meal", hi: "पिज़्ज़ा के दो स्लाइस", want: "pizza ke do slice" },
  { id: "m-maggi", kind: "meal", hi: "एक पैकेट मैगी", want: "ek packet maggi" },
  { id: "m-pasta", kind: "meal", hi: "व्हाइट सॉस पास्ता", want: "white sauce pasta" },
  { id: "m-cornflakes", kind: "meal", hi: "एक कटोरी कॉर्नफ्लेक्स दूध के साथ", want: "ek katori cornflakes doodh ke saath" },
  { id: "m-banana-shake", kind: "meal", hi: "बनाना शेक", want: "banana shake" },
  { id: "m-juice", kind: "meal", hi: "एक गिलास संतरे का जूस", want: "ek gilas|gilaas|glass santre ka juice" },
  { id: "m-coke", kind: "meal", hi: "एक कोक", want: "ek coke" },
  { id: "m-green-tea", kind: "meal", hi: "ग्रीन टी बिना चीनी", want: "green tea bina cheeni|chini" },
  { id: "m-filter-coffee", kind: "meal", hi: "फिल्टर कॉफी", want: "filter coffee" },
  { id: "m-workout", kind: "meal", hi: "वर्कआउट के बाद प्रोटीन शेक", want: "workout ke baad protein shake" },
  { id: "m-gym-banana", kind: "meal", hi: "जिम से पहले एक केला", want: "gym se pehle|pahle ek kela" },
  { id: "m-greek", kind: "meal", hi: "ग्रीक योगर्ट और ग्रेनोला", want: "greek yogurt|yoghurt aur granola" },
  { id: "m-soya", kind: "meal", hi: "सोया चंक्स की सब्जी", want: "soya chunks ki sabji|sabzi" },
  { id: "m-momos", kind: "meal", hi: "चिकन मोमोज़ एक प्लेट", want: "chicken momos ek plate" },
  { id: "m-fish-fry", kind: "meal", hi: "फिश फ्राई एक पीस", want: "fish fry ek piece" },
  { id: "m-egg-curry", kind: "meal", hi: "एग करी दो रोटी के साथ", want: "egg curry do roti ke saath" },
  { id: "m-mutton-curry", kind: "meal", hi: "मटन करी और चावल", want: "mutton curry aur chawal" },
  { id: "m-butter-chicken", kind: "meal", hi: "बटर चिकन और जीरा राइस", want: "butter chicken aur jeera rice" },
  { id: "m-muesli", kind: "meal", hi: "म्यूसली और दही", want: "muesli aur dahi" },
  { id: "m-olive-oil", kind: "meal", hi: "एक चम्मच ऑलिव ऑयल", want: "ek chammach|chamach olive oil" },
  { id: "m-chowmein", kind: "meal", hi: "वेज चाउमीन और मंचूरियन", want: "veg chowmein|chowmien aur manchurian" },
  { id: "m-cold-coffee", kind: "meal", hi: "एक कोल्ड कॉफी विद आइसक्रीम", want: "ek cold coffee with ice cream" },
  { id: "m-mac-cheese", kind: "meal", hi: "एक प्लेट मैक एंड चीज़", want: "ek plate mac and cheez|cheese", note: "live check: 'maik and cheez' was logged as makki roti" },

  // ── Everyday Indian dishes ──
  { id: "m-poha", kind: "meal", hi: "एक प्लेट पोहा और एक कप चाय", want: "ek plate poha aur ek cup chai" },
  { id: "m-idli", kind: "meal", hi: "दो इडली सांभर और नारियल चटनी", want: "do idli sambhar|sambar aur nariyal chatni|chutney" },
  { id: "m-dosa", kind: "meal", hi: "एक मसाला डोसा", want: "ek masala dosa" },
  { id: "m-chhole", kind: "meal", hi: "छोले भटूरे एक प्लेट", want: "chhole|chole bhature|bhatoore ek plate" },
  { id: "m-paratha", kind: "meal", hi: "दो आलू पराठे दही के साथ", want: "do aloo parathe dahi ke saath" },
  { id: "m-biryani", kind: "meal", hi: "चिकन बिरयानी एक प्लेट और रायता", want: "chicken biryani ek plate aur raita" },
  { id: "m-lassi", kind: "meal", hi: "एक गिलास लस्सी", want: "ek gilas|gilaas|glass lassi" },
  { id: "m-chhachh", kind: "meal", hi: "एक गिलास छाछ", want: "ek gilas|gilaas|glass chhachh|chaach" },
  { id: "m-kadhi", kind: "meal", hi: "कढ़ी चावल", want: "kadhi chawal" },
  { id: "m-khichdi", kind: "meal", hi: "मूंग दाल की खिचड़ी", want: "moong dal ki khichdi" },
  { id: "m-bhindi", kind: "meal", hi: "भिंडी की सब्जी और तीन रोटी", want: "bhindi ki sabji|sabzi aur teen roti" },
  { id: "m-aloo-gobhi", kind: "meal", hi: "आलू गोभी और दो चपाती", want: "aloo gobhi|gobi aur do chapati" },
  { id: "m-makhni", kind: "meal", hi: "दाल मखनी और दो नान", want: "dal makhni|makhani aur do naan" },
  { id: "m-tandoori", kind: "meal", hi: "तंदूरी रोटी दो और पनीर टिक्का", want: "tandoori roti do aur paneer tikka" },
  { id: "m-makhana", kind: "meal", hi: "मखाना एक कटोरी", want: "makhana ek katori" },
  { id: "m-vada-pav", kind: "meal", hi: "वड़ा पाव दो", want: "vada|wada pav|pao do", note: "पाव as the bread" },
  { id: "m-pav-bhaji", kind: "meal", hi: "पाव भाजी एक प्लेट", want: "pav|pao bhaji ek plate" },
  { id: "m-samose", kind: "meal", hi: "दो समोसे और एक कप चाय", want: "do samose aur ek cup chai" },
  { id: "m-upma", kind: "meal", hi: "उपमा एक कटोरी", want: "upma ek katori" },
  { id: "m-saag", kind: "meal", hi: "सरसों का साग और मक्के की रोटी", want: "sarson ka saag aur makke ki roti" },
  { id: "m-gulab-jamun", kind: "meal", hi: "गुलाब जामुन दो", want: "gulab jamun do" },
  { id: "m-kheer", kind: "meal", hi: "एक कटोरी खीर", want: "ek katori kheer" },
  { id: "m-pulao", kind: "meal", hi: "वेज पुलाव और रायता", want: "veg pulao aur raita" },
  { id: "m-tadka", kind: "meal", hi: "दाल तड़का और जीरा राइस", want: "dal tadka aur jeera rice" },
  { id: "m-maggi-eggs", kind: "meal", hi: "मैगी में दो अंडे डाले", want: "maggi mein do ande dale|daale" },
  { id: "m-dhokla", kind: "meal", hi: "चार पीस ढोकला और हरी चटनी", want: "chaar piece dhokla aur hari chatni|chutney" },
  { id: "m-thali", kind: "meal", hi: "एक वेज थाली", want: "ek veg thali" },

  // ── Meals in sentences ──
  { id: "m-nashta", kind: "meal", hi: "नाश्ते में पोहा और दोपहर में दाल चावल", want: "nashte mein poha aur dopahar mein dal chawal" },
  { id: "m-raat", kind: "meal", hi: "रात को दो रोटी और पनीर", want: "raat ko do roti aur paneer" },
  { id: "m-lunch", kind: "meal", hi: "मैंने लंच में चिकन राइस खाया", want: "maine lunch mein chicken rice khaya" },
  { id: "m-dinner", kind: "meal", hi: "डिनर में खिचड़ी और दही", want: "dinner mein khichdi aur dahi" },
  { id: "m-breakfast", kind: "meal", hi: "ब्रेकफास्ट में ओट्स और बनाना", want: "breakfast mein oats aur banana" },
  { id: "m-snacks", kind: "meal", hi: "शाम को स्नैक्स में मखाना", want: "shaam ko snacks mein makhana" },
  { id: "m-period", kind: "meal", hi: "दो रोटी और चने की सब्जी।", want: "do roti aur chane ki sabji|sabzi" },

  // ── English passed through in Latin letters ──
  { id: "m-latin-mixed", kind: "meal", hi: "200 gram चावल और chicken", want: "200 gram chawal aur chicken", form: "latin mixed" },
  { id: "m-latin-shake", kind: "meal", hi: "protein shake और दो केले", want: "protein shake aur do kele", form: "latin mixed" },
  { id: "m-latin-kfc", kind: "meal", hi: "KFC का बर्गर", want: "KFC ka burger", form: "latin mixed" },
  { id: "m-latin-dominos", kind: "meal", hi: "Domino's पिज़्ज़ा दो स्लाइस", want: "Domino's pizza do slice", form: "latin mixed" },

  // ── Ask questions ──
  { id: "a-protein", kind: "ask", hi: "मुझे रोज़ कितना प्रोटीन खाना चाहिए", want: "mujhe roz kitna protein khana chahiye" },
  { id: "a-vit-d", kind: "ask", hi: "मेरा विटामिन डी कम है क्या करूं", want: "mera vitamin d kam hai kya karun|karu|karoon" },
  { id: "a-creatine", kind: "ask", hi: "क्रिएटिन लेना सेफ है क्या?", want: "creatine lena safe hai kya" },
  { id: "a-pre-workout", kind: "ask", hi: "वर्कआउट से पहले क्या खाऊं", want: "workout se pehle|pahle kya khaun|khau|khaoon" },
  { id: "a-weight-loss", kind: "ask", hi: "वेट लॉस के लिए क्या खाना चाहिए", want: "weight loss ke liye kya khana chahiye" },
  { id: "a-muscle", kind: "ask", hi: "मसल गेन के लिए डाइट बताओ", want: "muscle gain ke liye diet batao" },
  { id: "a-hb", kind: "ask", hi: "मेरी रिपोर्ट में हीमोग्लोबिन कम है", want: "meri report mein hemoglobin|haemoglobin kam hai" },
  { id: "a-iron", kind: "ask", hi: "आयरन कैसे बढ़ाऊं", want: "iron kaise badhaun|badhau|badhaoon" },
  { id: "a-thyroid", kind: "ask", hi: "थायराइड में क्या नहीं खाना चाहिए", want: "thyroid mein kya nahi|nahin khana chahiye" },
  { id: "a-eggs", kind: "ask", hi: "रोज़ कितने अंडे खा सकता हूं", want: "roz kitne ande kha sakta hoon|hun|hu" },
  { id: "a-stack", kind: "ask", hi: "मेरा स्टैक कहां है", want: "mera stack kahan|kaha hai" },
  { id: "a-upload", kind: "ask", hi: "रिपोर्ट कैसे अपलोड करूं", want: "report kaise upload karun|karu|karoon" },
  { id: "a-cholesterol", kind: "ask", hi: "कोलेस्ट्रॉल कम करने के लिए क्या खाऊं", want: "cholesterol kam karne ke liye kya khaun|khau|khaoon" },
  { id: "a-veg", kind: "ask", hi: "मैं वेजिटेरियन हूं प्रोटीन कहां से लूं", want: "main|mai vegetarian hoon|hun|hu protein kahan|kaha se loon|lun|lu" },
  { id: "a-b12", kind: "ask", hi: "बी12 के लिए क्या खाऊं", want: "b12 ke liye kya khaun|khau|khaoon" },
  { id: "a-sugar", kind: "ask", hi: "शुगर लेवल कैसे कंट्रोल करूं", want: "sugar level kaise control karun|karu|karoon" },
  { id: "a-whey", kind: "ask", hi: "व्हे प्रोटीन अच्छा है या प्लांट प्रोटीन", want: "whey protein achha|accha|acha hai ya plant protein" },
  { id: "a-magnesium", kind: "ask", hi: "मैग्नीशियम की गोली रात को लूं क्या", want: "magnesium ki goli raat ko loon|lun|lu kya" },
  { id: "a-fuel", kind: "ask", hi: "फ्यूल में खाना कैसे लॉग करूं", want: "fuel mein khana kaise log karun|karu|karoon" },
  { id: "a-bp", kind: "ask", hi: "हाई बीपी में नमक कितना खाऊं", want: "high bp mein namak kitna khaun|khau|khaoon" },
  { id: "a-running", kind: "ask", hi: "रनिंग के बाद क्या खाना चाहिए", want: "running ke baad kya khana chahiye" },
  { id: "a-vrat", kind: "ask", hi: "व्रत में प्रोटीन कैसे लूं", want: "vrat mein protein kaise loon|lun|lu" },
  { id: "a-gas", kind: "ask", hi: "मुझे गैस बनती है दाल से", want: "mujhe gas banti hai dal se" },
  { id: "a-multi", kind: "ask", hi: "मल्टीविटामिन रोज़ लेना चाहिए क्या", want: "multivitamin roz lena chahiye kya" },
  { id: "a-exercise", kind: "ask", hi: "एक्सरसाइज के बाद मसल्स में दर्द होता है", want: "exercise ke baad muscles mein dard hota hai" },
  { id: "a-low-carb", kind: "ask", hi: "लो कार्ब डाइट सही है क्या", want: "low carb diet sahi hai kya" },
];

/**
 * Written after the word list was fitted to TRANSCRIPTS, and scored once before anything was
 * changed for them: the honest measure of how romanize() does on words it wasn't tuned on.
 * First run, 2026-11-22: 40 of 47 (the code before that day's word list: 33). The misses were
 * English food words not yet on the list ("miks", "garlik", "rask", "meel", "hol",
 * "daijestiv"), which then went on it. A fresh held-out set is the only way to re-measure.
 */
export const HELD_OUT: Transcript[] = [
  { id: "h-palak", kind: "meal", hi: "एक कटोरी पालक पनीर और दो फुल्के", want: "ek katori palak paneer aur do phulke|fulke" },
  { id: "h-400", kind: "meal", hi: "चार सौ ग्राम दही", want: "chaar|char sau gram dahi", form: "number words" },
  { id: "h-soya-100", kind: "meal", hi: "100 ग्राम सोया चंक्स उबले हुए", want: "100 gram soya chunks uble hue|huye", form: "digits", note: "huye first graded as a miss: a grader slip, both are common" },
  { id: "h-toast", kind: "meal", hi: "दो ब्रेड टोस्ट बटर के साथ", want: "do bread toast butter ke saath" },
  { id: "h-without", kind: "meal", hi: "एक कप कॉफी विदाउट शुगर", want: "ek cup coffee without sugar" },
  { id: "h-mix-veg", kind: "meal", hi: "मिक्स वेज और दो रोटी", want: "mix veg aur do roti" },
  { id: "h-fruit-salad", kind: "meal", hi: "एक बाउल फ्रूट सलाद", want: "ek bowl fruit salad" },
  { id: "h-tikka-roll", kind: "meal", hi: "दो चिकन टिक्का रोल", want: "do chicken tikka roll" },
  { id: "h-paneer-bhurji", kind: "meal", hi: "पनीर भुर्जी और दो पराठे", want: "paneer bhurji aur do parathe" },
  { id: "h-badam-doodh", kind: "meal", hi: "एक गिलास बादाम वाला दूध", want: "ek gilas|gilaas|glass badam wala doodh" },
  { id: "h-dhai-katori", kind: "meal", hi: "ढाई कटोरी चावल और राजमा", want: "dhai katori chawal aur rajma", form: "fraction words" },
  { id: "h-fried-rice", kind: "meal", hi: "एक प्लेट चिकन फ्राइड राइस", want: "ek plate chicken fried rice" },
  { id: "h-oats-honey", kind: "meal", hi: "ओट्स में केला और शहद", want: "oats mein kela aur shahad|shehad" },
  { id: "h-dedh-gilas", kind: "meal", hi: "डेढ़ गिलास छाछ", want: "dedh gilas|gilaas|glass chhachh|chaach", form: "fraction words" },
  { id: "h-egg-white", kind: "meal", hi: "तीन एग व्हाइट और एक होल एग", want: "teen egg white aur ek whole egg" },
  { id: "h-protein-bar", kind: "meal", hi: "एक प्रोटीन बार", want: "ek protein bar" },
  { id: "h-kele-doodh", kind: "meal", hi: "दो केले और एक गिलास दूध", want: "do kele aur ek gilas|gilaas|glass doodh" },
  { id: "h-pavbhaji", kind: "meal", hi: "पावभाजी विद एक्स्ट्रा बटर", want: "pavbhaji with extra butter" },
  { id: "h-papad", kind: "meal", hi: "रात में खिचड़ी और पापड़", want: "raat mein khichdi aur papad" },
  { id: "h-masala-oats", kind: "meal", hi: "मसाला ओट्स एक बाउल", want: "masala oats ek bowl" },
  { id: "h-digestive", kind: "meal", hi: "एक कप ग्रीन टी और दो डाइजेस्टिव बिस्कुट", want: "ek cup green tea aur do digestive biscuit" },
  { id: "h-garlic", kind: "meal", hi: "चिकन सूप और गार्लिक ब्रेड", want: "chicken soup aur garlic bread" },
  { id: "h-butter-naan", kind: "meal", hi: "पनीर टिक्का मसाला और बटर नान", want: "paneer tikka masala aur butter naan" },
  { id: "h-2-eggs", kind: "meal", hi: "2 उबले अंडे और ब्लैक कॉफी", want: "2 uble ande aur black coffee", form: "digits" },
  { id: "h-sprouts", kind: "meal", hi: "स्प्राउट्स चाट एक कटोरी", want: "sprouts chaat ek katori" },
  { id: "h-khaye", kind: "meal", hi: "मैंने दोपहर में राजमा चावल खाए", want: "maine dopahar mein rajma chawal khaye" },
  { id: "h-achar", kind: "meal", hi: "दही चावल और अचार", want: "dahi chawal aur achar|achaar" },
  { id: "h-moongfali", kind: "meal", hi: "एक मुट्ठी मूंगफली", want: "ek mutthi moongfali|mungfali" },
  { id: "h-milakar", kind: "meal", hi: "एक स्कूप प्रोटीन दूध में मिलाकर", want: "ek scoop protein doodh mein milakar" },
  { id: "h-aadhi", kind: "meal", hi: "आधी प्लेट बिरयानी", want: "aadhi|adhi plate biryani", form: "fraction words" },
  { id: "h-aloo-ke", kind: "meal", hi: "दो आलू के पराठे और अचार", want: "do aloo ke parathe aur achar|achaar" },
  { id: "h-gunguna", kind: "meal", hi: "सुबह खाली पेट गुनगुना पानी", want: "subah khali pet gunguna pani|paani" },
  { id: "h-botal", kind: "meal", hi: "एक बोतल कोल्ड ड्रिंक", want: "ek botal|bottle cold drink" },
  { id: "h-rusk", kind: "meal", hi: "चाय के साथ दो रस्क", want: "chai ke saath do rusk" },
  { id: "h-papita", kind: "meal", hi: "फ्रूट्स में पपीता और सेब", want: "fruits mein papita|papeeta aur seb" },
  { id: "ha-kela", kind: "ask", hi: "क्या मैं रात को केला खा सकता हूं", want: "kya main|mai raat ko kela kha sakta hoon|hun|hu" },
  { id: "ha-kidney", kind: "ask", hi: "प्रोटीन पाउडर से किडनी खराब होती है क्या", want: "protein powder se kidney kharab hoti hai kya" },
  { id: "ha-ferritin", kind: "ask", hi: "मेरा फेरिटिन लो है तो क्या खाऊं", want: "mera ferritin low|lo hai to kya khaun|khau|khaoon" },
  { id: "ha-gym", kind: "ask", hi: "हफ्ते में कितनी बार जिम जाना चाहिए", want: "hafte mein kitni baar gym jana|jaana chahiye" },
  { id: "ha-green-tea", kind: "ask", hi: "क्या ग्रीन टी से वेट कम होता है", want: "kya green tea se weight kam hota hai" },
  { id: "ha-tablet", kind: "ask", hi: "विटामिन डी की टेबलेट कब लेनी चाहिए", want: "vitamin d ki tablet kab leni chahiye" },
  { id: "ha-target", kind: "ask", hi: "मेरा टारगेट कितनी कैलोरी का है", want: "mera target kitni calorie ka hai" },
  { id: "ha-periods", kind: "ask", hi: "पीरियड्स में क्या खाना चाहिए", want: "periods mein kya khana chahiye" },
  { id: "ha-diabetes", kind: "ask", hi: "डायबिटीज में चावल खा सकते हैं क्या", want: "diabetes mein chawal kha sakte hain kya" },
  { id: "ha-supplements", kind: "ask", hi: "सप्लीमेंट्स कब तक लेने हैं", want: "supplements kab tak lene hain" },
  { id: "ha-thakan", kind: "ask", hi: "मुझे थकान बहुत होती है", want: "mujhe thakan|thakaan bahut hoti hai" },
  { id: "ha-meal", kind: "ask", hi: "पोस्ट वर्कआउट मील में क्या लूं", want: "post workout meal mein kya loon|lun|lu" },
];

const clean = (w: string) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}']+$/gu, "");

/** Whether `out` reads as `want`: the same words, each in one of the spellings `want` accepts. */
export function readsNaturally(out: string, want: string): { ok: boolean; why: string } {
  const got = out.split(/\s+/).map(clean).filter(Boolean);
  const exp = want.split(/\s+/).filter(Boolean).map((t) => t.split("|").map(clean));
  if (got.length !== exp.length) return { ok: false, why: `${got.length} words, want ${exp.length}` };
  const bad = exp.map((alts, i) => (alts.includes(got[i]) ? null : `${got[i]} ≠ ${alts.join("|")}`)).filter(Boolean);
  return bad.length ? { ok: false, why: bad.join(", ") } : { ok: true, why: "" };
}
