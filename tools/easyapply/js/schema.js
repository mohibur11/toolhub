// The EasyApply profile form: sections, fields, dropdown lists and validation.
// Field names are Teletalk's own (see fields.js); rules copy Teletalk's validator.js so a saved
// profile passes the real form's checks.

import { LOOKUPS } from './lookups.js?v=1';
import { groupTypes, gpaMax, OTHER_CODE, hasLevel } from './fields.js?v=1';

const E = (en, bn) => ({ en, bn });
const L = (en, bn) => ({ en, bn });

// ---- checks (each returns an error {en,bn} or null) ----
const EN_NAME = /^[A-Za-z'. \-()]+$/;
const isBangla = (s) => {
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (!((c >= 2432 && c <= 2559) || c === 2404 || [8, 13, 32, 40, 41, 44, 45, 46, 47, 58, 59].includes(c))) return false;
  }
  return true;
};
const enName = (v) => (!EN_NAME.test(v) ? E("English letters only (A–Z, space, dot, ' - ( )).", "শুধু ইংরেজি অক্ষর (A–Z, স্পেস, ডট, ' - ( ))।") : v.trim().length < 3 ? E('Too short.', 'খুব ছোট।') : null);
const bnText = (v) => (!isBangla(v) ? E('Bangla (Unicode) letters only.', 'শুধু বাংলা (ইউনিকোড) অক্ষর।') : null);
const englishText = (v) => (!/^[\x20-\x7E\r\n]+$/.test(v) ? E('Write this in English.', 'ইংরেজিতে লিখুন।') : null);
const digitsLen = (lens, en, bn) => (v) => (!/^\d+$/.test(v) || !lens.includes(v.length) ? E(en, bn) : null);
const mobile = (v) => (!/^01\d{9}$/.test(v) ? E('11 digits starting with 01.', '০১ দিয়ে শুরু ১১ ডিজিট।') : null);
const email = (v) => (!/^[^\s@<>()[\]\\,;:"]+@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}$/.test(v) ? E('Not a valid email address.', 'সঠিক ইমেইল ঠিকানা নয়।') : null);
const postcode = (v) => (!/^\d{4}$/.test(v) || +v < 1000 ? E('4-digit post code (1000–9999).', '৪ ডিজিটের পোস্ট কোড (১০০০–৯৯৯৯)।') : null);
const roll = (v) => (!/^\d{1,20}$/.test(v) ? E('Digits only.', 'শুধু সংখ্যা।') : null);
const dateCheck = (v) => (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v)) ? E('Pick a valid date.', 'সঠিক তারিখ দিন।') : null);
const dobCheck = (v) => {
  const e = dateCheck(v);
  if (e) return e;
  const age = (Date.now() - Date.parse(v)) / (365.25 * 86400000);
  return age < 14 || age > 70 ? E('Check the year of birth.', 'জন্মসাল আবার দেখুন।') : null;
};
const gpaCheck = (lvl) => (v, d) => {
  const max = gpaMax(d[lvl + '_result_type']);
  const n = Number(v);
  if (!/^\d(\.\d{1,2})?$/.test(v) || n < 1 || n > max) return E(`GPA between 1.00 and ${max}.00 (up to 2 decimals).`, `জিপিএ ১.০০ থেকে ${max}.০০ (সর্বোচ্চ ২ দশমিক)।`);
  return null;
};

// ---- dropdown helpers ----
const yes = [['1', 'Yes'], ['0', 'No']];
const YEARS = (() => {
  const out = [];
  for (let y = new Date().getFullYear(); y >= 1970; y--) out.push([String(y), String(y)]);
  return out;
})();
const pair = (rows) => rows.map((r) => [r[0], r[1]]);
const upazilasOf = (dist) => LOOKUPS.upazilas.filter((u) => u[2] === String(dist)).map((u) => [u[0], u[1]]);
const groupsOf = (lvl) => (d) => {
  const types = groupTypes(lvl, d[lvl + '_exam']);
  const all = LOOKUPS[lvl === 'gra' || lvl === 'mas' ? lvl + '_subject' : lvl + '_group'];
  if (types === null) return pair(all);
  return all.filter((g) => types.includes(g[2])).map((g) => [g[0], g[1]]);
};

// Bangla display names for a few short English lists (values stay English, as Teletalk wants).
export const OPTION_BN = {
  religion: { 1: 'ইসলাম', 2: 'হিন্দু', 3: 'বৌদ্ধ', 4: 'খ্রিস্টান', 5: 'অন্যান্য' },
  gender: { Male: 'পুরুষ', Female: 'নারী', 'Third Gender': 'তৃতীয় লিঙ্গ' },
  marital_status: { Single: 'অবিবাহিত', Married: 'বিবাহিত', Other: 'অন্যান্য' },
  yesno: { 1: 'হ্যাঁ', 0: 'না' },
  quota: { 1: 'মুক্তিযোদ্ধার সন্তান', 2: 'শহীদ মুক্তিযোদ্ধার সন্তান', 3: 'বীরাঙ্গনার সন্তান', 4: 'শারীরিক প্রতিবন্ধী', 6: 'ক্ষুদ্র নৃগোষ্ঠী', 7: 'তৃতীয় লিঙ্গ', 8: 'প্রযোজ্য নয়' },
  dep_status: { 1: 'সরকারি চাকরিজীবী', 2: 'আধা-সরকারি চাকরিজীবী', 3: 'স্বায়ত্তশাসিত', 4: 'বিভাগীয় প্রার্থী', 5: 'প্রযোজ্য নয়' },
};

// ---- address block ----
function addressFields(kind) {
  const p = kind + '_';
  const show = kind === 'permanent' ? (d) => d.same_as_present !== '1' : undefined;
  return [
    { name: p + 'careof', type: 'text', max: 50, label: L('Care of', 'কেয়ার অফ (যার মাধ্যমে)'), hint: L('e.g. father’s name', 'যেমন: পিতার নাম'), show, check: englishText },
    { name: p + 'village', type: 'textarea', max: 150, label: L('Village / Road / House / Flat', 'গ্রাম / রাস্তা / বাসা / ফ্ল্যাট'), show, check: englishText },
    { name: p + 'district', type: 'select', lookup: () => LOOKUPS.districts.map((x) => [x[0], x[1]]), label: L('District', 'জেলা'), show, resets: [p + 'upazila'] },
    { name: p + 'upazila', type: 'select', lookup: (d) => upazilasOf(d[p + 'district']), label: L('Upazila / P.S.', 'উপজেলা / থানা'), show, emptyHint: L('Pick the district first', 'আগে জেলা বাছাই করুন') },
    { name: p + 'post', type: 'text', max: 50, label: L('Post office', 'ডাকঘর'), show, check: englishText },
    { name: p + 'postcode', type: 'digits', max: 4, label: L('Post code', 'পোস্ট কোড'), show, check: postcode },
  ];
}

// ---- education block ----
const LEVEL = {
  ssc: { title: L('SSC or equivalent', 'এসএসসি / সমমান'), toggle: L('I have passed SSC or equivalent', 'আমি এসএসসি বা সমমান পাস করেছি') },
  hsc: { title: L('HSC or equivalent', 'এইচএসসি / সমমান'), toggle: L('I have passed HSC or equivalent', 'আমি এইচএসসি বা সমমান পাস করেছি') },
  gra: { title: L('Graduation', 'স্নাতক (অনার্স / পাস / সমমান)'), toggle: L('I have a graduation degree', 'আমার স্নাতক ডিগ্রি আছে') },
  mas: { title: L('Masters', 'স্নাতকোত্তর (মাস্টার্স)'), toggle: L('I have a masters degree', 'আমার স্নাতকোত্তর ডিগ্রি আছে') },
};

function eduFields(lvl) {
  const on = (d) => hasLevel(d, lvl);
  const p = lvl + '_';
  const school = lvl === 'ssc' || lvl === 'hsc';
  const f = [{ name: p + 'exam', type: 'select', lookup: () => LOOKUPS[p + 'exam'], label: L('Examination', 'পরীক্ষার নাম'), show: on, resets: school || lvl === 'gra' ? [p + (school ? 'group' : 'subject')] : [] }];
  if (school) {
    f.push(
      { name: p + 'board', type: 'select', lookup: () => LOOKUPS[p + 'board'], label: L('Board', 'বোর্ড'), show: on },
      { name: p + 'board_other', type: 'text', max: 50, label: L('Board name', 'বোর্ডের নাম'), show: (d) => on(d) && d[p + 'board'] === OTHER_CODE.board, check: englishText },
      { name: p + 'roll', type: 'digits', max: 20, label: L('Roll number', 'রোল নম্বর'), show: on, check: roll },
      { name: p + 'group', type: 'select', lookup: groupsOf(lvl), label: L('Group / Subject', 'বিভাগ / বিষয়'), show: on, emptyHint: L('Pick the examination first', 'আগে পরীক্ষা বাছাই করুন') },
      { name: p + 'group_other', type: 'text', max: 50, label: L('Group name', 'বিভাগের নাম'), show: (d) => on(d) && d[p + 'group'] === OTHER_CODE.group, check: englishText },
    );
  } else {
    f.push(
      { name: p + 'institute', type: 'select', lookup: () => LOOKUPS[p + 'institute'], label: L('University / Institute', 'বিশ্ববিদ্যালয় / প্রতিষ্ঠান'), show: on, search: true },
      { name: p + 'institute_other', type: 'text', max: 100, label: L('Institute name', 'প্রতিষ্ঠানের নাম'), show: (d) => on(d) && d[p + 'institute'] === OTHER_CODE.institute, check: englishText },
      { name: p + 'subject', type: 'select', lookup: groupsOf(lvl), label: L('Subject / Degree', 'বিষয় / ডিগ্রি'), show: on, search: true, emptyHint: L('Pick the examination first', 'আগে পরীক্ষা বাছাই করুন') },
      { name: p + 'subject_other', type: 'text', max: 100, label: L('Subject name', 'বিষয়ের নাম'), show: (d) => on(d) && d[p + 'subject'] === OTHER_CODE.subject, check: englishText },
    );
  }
  f.push(
    { name: p + 'result_type', type: 'select', lookup: () => LOOKUPS[p + 'result_type'], label: L('Result', 'ফলাফল'), show: on },
    { name: p + 'result', type: 'gpa', label: L(school ? 'GPA' : 'CGPA', school ? 'জিপিএ' : 'সিজিপিএ'), show: (d) => on(d) && gpaMax(d[p + 'result_type']) > 0, check: gpaCheck(lvl) },
    { name: p + 'year', type: 'select', lookup: () => YEARS, label: L('Passing year', 'পাসের সাল'), show: on },
  );
  if (!school) f.push({ name: p + 'duration', type: 'select', lookup: () => LOOKUPS[p + 'duration'], label: L('Course duration', 'কোর্সের মেয়াদ'), show: on });
  return f;
}

// ---- sections ----
export const SECTIONS = [
  {
    id: 'personal',
    title: L('Personal information', 'ব্যক্তিগত তথ্য'),
    fields: [
      { name: 'name', type: 'en', upper: true, max: 50, label: L("Applicant's name (English)", 'আবেদনকারীর নাম (ইংরেজিতে)'), hint: L('As on your SSC certificate', 'এসএসসি সনদ অনুযায়ী'), check: enName },
      { name: 'name_bn', type: 'bn', max: 50, label: L("Applicant's name (Bangla)", 'আবেদনকারীর নাম (বাংলায়)'), hint: L('Use a Bangla keyboard (e.g. Gboard → Bangla)', 'বাংলা কিবোর্ড ব্যবহার করুন (যেমন Gboard → বাংলা)'), check: bnText },
      { name: 'father', type: 'en', upper: true, max: 50, label: L("Father's name (English)", 'পিতার নাম (ইংরেজিতে)'), check: enName },
      { name: 'father_bn', type: 'bn', max: 50, label: L("Father's name (Bangla)", 'পিতার নাম (বাংলায়)'), check: bnText },
      { name: 'mother', type: 'en', upper: true, max: 50, label: L("Mother's name (English)", 'মাতার নাম (ইংরেজিতে)'), check: enName },
      { name: 'mother_bn', type: 'bn', max: 50, label: L("Mother's name (Bangla)", 'মাতার নাম (বাংলায়)'), check: bnText },
      { name: 'dob', type: 'date', label: L('Date of birth', 'জন্ম তারিখ'), check: dobCheck },
      { name: 'religion', type: 'select', lookup: () => LOOKUPS.religion, bnKey: 'religion', label: L('Religion', 'ধর্ম') },
      { name: 'gender', type: 'select', lookup: () => LOOKUPS.gender, bnKey: 'gender', label: L('Gender', 'লিঙ্গ') },
    ],
  },
  {
    id: 'identity',
    title: L('ID and marital status', 'পরিচয়পত্র ও বৈবাহিক অবস্থা'),
    fields: [
      { name: 'nid', type: 'select', lookup: () => yes, bnKey: 'yesno', label: L('Do you have a National ID?', 'জাতীয় পরিচয়পত্র (NID) আছে?') },
      { name: 'nid_no', type: 'digits', max: 17, label: L('National ID number', 'জাতীয় পরিচয়পত্র নম্বর'), show: (d) => d.nid === '1', check: digitsLen([10, 13, 17], 'NID must be 10, 13 or 17 digits.', 'এনআইডি ১০, ১৩ বা ১৭ ডিজিট হতে হবে।') },
      { name: 'breg', type: 'select', lookup: () => yes, bnKey: 'yesno', label: L('Do you have a Birth Registration?', 'জন্ম নিবন্ধন আছে?') },
      { name: 'breg_no', type: 'digits', max: 17, label: L('Birth Registration number', 'জন্ম নিবন্ধন নম্বর'), show: (d) => d.breg === '1', check: digitsLen([16, 17], 'Birth Registration must be 16 or 17 digits.', 'জন্ম নিবন্ধন ১৬ বা ১৭ ডিজিট হতে হবে।') },
      { name: 'passport', type: 'select', lookup: () => yes, bnKey: 'yesno', label: L('Do you have a passport?', 'পাসপোর্ট আছে?') },
      { name: 'passport_no', type: 'text', max: 15, upper: true, label: L('Passport number', 'পাসপোর্ট নম্বর'), show: (d) => d.passport === '1', check: (v) => (!/^[A-Za-z0-9]+$/.test(v) ? E('Letters and digits only.', 'শুধু ইংরেজি অক্ষর ও সংখ্যা।') : null) },
      { name: 'marital_status', type: 'select', lookup: () => LOOKUPS.marital_status, bnKey: 'marital_status', label: L('Marital status', 'বৈবাহিক অবস্থা') },
      { name: 'spouse_name', type: 'en', upper: true, max: 50, label: L("Spouse's name (English)", 'স্বামী/স্ত্রীর নাম (ইংরেজিতে)'), show: (d) => d.marital_status === 'Married', check: enName },
    ],
  },
  {
    id: 'contact',
    title: L('Contact and quota', 'যোগাযোগ ও কোটা'),
    fields: [
      { name: 'mobile', type: 'tel', max: 11, label: L('Mobile number', 'মোবাইল নম্বর'), hint: L('Teletalk sends your User ID here', 'টেলিটক এই নম্বরে ইউজার আইডি পাঠাবে'), check: mobile },
      { name: 'email', type: 'email', max: 50, label: L('Email', 'ইমেইল'), check: email },
      { name: 'quota', type: 'select', lookup: () => LOOKUPS.quota, bnKey: 'quota', label: L('Quota / age relaxation', 'কোটা / বয়সে ছাড়') },
      {
        name: 'quota_details',
        type: 'text',
        max: 100,
        label: L('Quota details', 'কোটার বিবরণ'),
        hint: L('Freedom fighter: name, certificate no., date. Ethnic minority: ethnicity name.', 'মুক্তিযোদ্ধা: নাম, সনদ নং, তারিখ। ক্ষুদ্র নৃগোষ্ঠী: নৃগোষ্ঠীর নাম।'),
        show: (d) => ['1', '2', '3', '6'].includes(d.quota),
        check: (v, d) => englishText(v) || (['1', '2', '3'].includes(d.quota) && v.trim().length < 6 ? E('At least 6 characters.', 'কমপক্ষে ৬ অক্ষর।') : null),
      },
      { name: 'dep_status', type: 'select', lookup: () => LOOKUPS.dep_status, bnKey: 'dep_status', label: L('Departmental status', 'বিভাগীয় অবস্থা') },
    ],
  },
  { id: 'present', title: L('Present address', 'বর্তমান ঠিকানা'), fields: addressFields('present') },
  {
    id: 'permanent',
    title: L('Permanent address', 'স্থায়ী ঠিকানা'),
    fields: [{ name: 'same_as_present', type: 'check', label: L('Same as present address', 'বর্তমান ঠিকানার মতোই') }, ...addressFields('permanent')],
  },
  ...['ssc', 'hsc', 'gra', 'mas'].map((lvl) => ({
    id: lvl,
    level: lvl,
    title: LEVEL[lvl].title,
    fields: [{ name: 'has_' + lvl, type: 'check', label: LEVEL[lvl].toggle }, ...eduFields(lvl)],
  })),
  { id: 'jobs', title: L('Job experience', 'চাকরির অভিজ্ঞতা'), jobs: true, fields: [] },
];

// Job fields (one card per job).
export const JOB_FIELDS = [
  { name: 'employment_type', type: 'select', lookup: () => LOOKUPS.employment_type, label: L('Employed on', 'চাকরির ধরন') },
  { name: 'designation', type: 'text', max: 50, label: L('Designation / post', 'পদবি'), check: englishText },
  { name: 'organization', type: 'text', max: 100, label: L('Organization', 'প্রতিষ্ঠান'), check: englishText },
  { name: 'office_address', type: 'text', max: 100, label: L('Office address', 'অফিসের ঠিকানা'), check: englishText },
  { name: 'job_start_date', type: 'date', label: L('Start date', 'যোগদানের তারিখ'), check: dateCheck },
  { name: 'currently_working', type: 'check', label: L('I still work here', 'এখনো এখানে কর্মরত') },
  { name: 'job_end_date', type: 'date', label: L('End date', 'শেষ তারিখ'), show: (j) => j.currently_working !== '1', check: (v, j) => dateCheck(v) || (j.job_start_date && v < j.job_start_date ? E('Ends before it starts.', 'শুরুর আগের তারিখ।') : null) },
  { name: 'last_salary', type: 'digits', max: 9, opt: true, label: L('Last drawn salary (Tk)', 'সর্বশেষ বেতন (টাকা)'), check: (v) => (!/^\d+$/.test(v) ? E('Digits only.', 'শুধু সংখ্যা।') : null) },
  { name: 'job_description', type: 'textarea', max: 300, label: L('Job description', 'কাজের বিবরণ'), check: englishText },
];

export const ALL_FIELDS = SECTIONS.flatMap((s) => s.fields);
export const FIELD = Object.fromEntries(ALL_FIELDS.map((f) => [f.name, f]));

export const isShown = (f, d) => !f.show || f.show(d);
export const optionsOf = (f, d) => (typeof f.lookup === 'function' ? f.lookup(d) : []);

/** Error for one field, or null. `d` is profile.data (or a job object for job fields). */
export function fieldError(f, d) {
  if (!isShown(f, d) || f.type === 'check') return null;
  const v = String(d[f.name] ?? '').trim();
  if (!v) return f.opt ? null : E('Required.', 'আবশ্যক।');
  if (f.max && v.length > f.max) return E(`At most ${f.max} characters.`, `সর্বোচ্চ ${f.max} অক্ষর।`);
  if (f.type === 'select' && !optionsOf(f, d).some((o) => o[0] === v)) return E('Pick again from the list.', 'তালিকা থেকে আবার বাছাই করুন।');
  return f.check ? f.check(v, d) : null;
}

/** All problems in a profile: { errors: {name: err}, jobErrors: [{name: err}], bySection: {id: count} } */
export function validateProfile(p) {
  const d = p.data || {};
  const errors = {};
  const bySection = {};
  for (const s of SECTIONS) {
    let n = 0;
    for (const f of s.fields) {
      const e = fieldError(f, d);
      if (e) {
        errors[f.name] = e;
        n++;
      }
    }
    bySection[s.id] = n;
  }
  if (d.nid !== '1' && d.breg !== '1') {
    errors.nid = E('You need a National ID or a Birth Registration.', 'জাতীয় পরিচয়পত্র অথবা জন্ম নিবন্ধন — অন্তত একটি লাগবে।');
    bySection.identity = (bySection.identity || 0) + 1;
  }
  const jobErrors = (p.jobs || []).map((j) => {
    const je = {};
    for (const f of JOB_FIELDS) {
      const e = fieldError(f, j);
      if (e) je[f.name] = e;
    }
    return je;
  });
  bySection.jobs = jobErrors.reduce((a, je) => a + Object.keys(je).length, 0);
  return { errors, jobErrors, bySection };
}

/** Option text for a code (what Teletalk shows in its dropdown), used as profile.labels. */
export function optionText(f, d, code) {
  const o = optionsOf(f, d).find((x) => x[0] === String(code));
  return o ? o[1] : '';
}
