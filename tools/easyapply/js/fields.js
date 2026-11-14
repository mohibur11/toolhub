// Teletalk form field names, shared by the EasyApply app, fill.js and "save this form".
// Every Teletalk department site uses these same names (checked against application.php, Nov 2026).

export const PROFILE_VERSION = 1;

// Plain fields stored in profile.data under the exact Teletalk `name`.
export const PERSONAL = ['name', 'name_bn', 'father', 'father_bn', 'mother', 'mother_bn', 'dob', 'nationality', 'religion', 'gender'];
export const IDENTITY = ['nid', 'nid_no', 'breg', 'breg_no', 'passport', 'passport_no', 'marital_status', 'spouse_name'];
export const CONTACT = ['mobile', 'email', 'quota', 'quota_details', 'dep_status'];
export const ADDRESS_PARTS = ['careof', 'village', 'district', 'upazila', 'post', 'postcode'];
export const PRESENT = ADDRESS_PARTS.map((p) => 'present_' + p);
export const PERMANENT = ADDRESS_PARTS.map((p) => 'permanent_' + p);

export const EDU_LEVELS = ['ssc', 'hsc', 'gra', 'mas'];
// Field suffixes per level, in the order fill.js sets them (exam first: it rebuilds the group/subject list).
export const EDU_PARTS = {
  ssc: ['exam', 'board', 'board_other', 'roll', 'group', 'group_other', 'result_type', 'result', 'year'],
  hsc: ['exam', 'board', 'board_other', 'roll', 'group', 'group_other', 'result_type', 'result', 'year'],
  gra: ['exam', 'institute', 'institute_other', 'subject', 'subject_other', 'result_type', 'result', 'year', 'duration'],
  mas: ['exam', 'institute', 'institute_other', 'subject', 'subject_other', 'result_type', 'result', 'year', 'duration'],
};
export const eduFields = (lvl) => EDU_PARTS[lvl].map((p) => `${lvl}_${p}`);

export const JOB_PARTS = ['employment_type', 'designation', 'organization', 'office_address', 'job_start_date', 'job_end_date', 'currently_working', 'last_salary', 'job_description'];

// Every flat field (not jobs, photo or the has_ssc/has_hsc/has_gra/has_mas switches).
export const FLAT = [...PERSONAL, ...IDENTITY, ...CONTACT, ...PRESENT, ...PERMANENT, ...EDU_LEVELS.flatMap(eduFields)];

// "Other" option codes that make Teletalk show a free-text box.
export const OTHER_CODE = { board: '99', group: '99', institute: '999', subject: '999' };

// Which result types need a GPA/CGPA number, and its maximum.
export const gpaMax = (resultType) => (String(resultType) === '4' ? 4 : String(resultType) === '5' ? 5 : 0);

// Teletalk's group/subject list filters (main.js onChangeExamTypeSSC/HSC/GRA), as type letters.
export function groupTypes(lvl, exam) {
  const e = parseInt(exam, 10);
  if (lvl === 'ssc') return e === 3 || e === 6 ? ['V', 'Z'] : ['G', 'Z'];
  if (lvl === 'hsc') {
    if (e === 4) return ['T', 'Z'];
    if (e === 7 || e === 10) return ['M', 'Z'];
    if (e === 8) return ['V', 'Z'];
    return ['G', 'Z'];
  }
  if (lvl === 'gra') {
    const map = { 1: 'E', 2: 'A', 3: 'M', 4: 'G', 5: 'P', 6: 'F', 7: 'B', 8: 'G' };
    return map[e] ? [map[e], 'Z'] : [];
  }
  return null; // masters: one fixed list
}

export function emptyProfile() {
  return {
    version: PROFILE_VERSION,
    updatedAt: '',
    data: { nationality: 'Bangladeshi', has_ssc: '1', nid: '1', breg: '0', passport: '0', quota: '8', dep_status: '5', marital_status: 'Single' },
    labels: { nationality: 'Bangladeshi', nid: 'Yes', breg: 'No', passport: 'No', quota: 'Not Applicable', dep_status: 'Not Applicable', marital_status: 'Single' },
    jobs: [],
    photo: null, // { data: base64 jpeg, bytes, takenAt: 'YYYY-MM-DD' }
    signature: null, // { data: base64 jpeg, bytes }
  };
}

export const hasLevel = (data, lvl) => data['has_' + lvl] === '1';
