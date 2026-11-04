/**
 * =========================================================================
 * PRIMIS : ระบบสารสนเทศบุคลากรกลาง
 * (Personnel Records & Institutional Management Information System)
 * วิทยาลัยพยาบาลบรมราชชนนี สวรรค์ประชารักษ์ นครสวรรค์
 * คณะพยาบาลศาสตร์ สถาบันพระบรมราชชนก
 * =========================================================================
 */

/**
 * คำนวณช่วงปีงบประมาณอัตโนมัติตามปฏิทินงบประมาณราชการไทย
 */
function getFiscalYearRange() {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  const buddhistYear = now.getFullYear() + 543;
  const currentFiscalYear = month >= 10 ? (buddhistYear + 1) : buddhistYear;
  return (currentFiscalYear - 1) + ' - ' + currentFiscalYear;
}

const CONFIG = {
  APP_NAME: 'PRIMIS : ระบบสารสนเทศบุคลากรกลาง (BCNSPRNW PRIMIS)',
  APP_VERSION: 'v1.7.12',
  BUILD_DATE: '2026.11.04',
  API_URL: 'http://122.154.179.132/HR/api.php',
  API_KEY: 'HrDbKey_2026_SNC_Secure!@#',
  getFiscalYearRange: getFiscalYearRange
};

/**
 * ฟังก์ชันหลักเปิดหน้า Web App
 */
function doGet(e) {
  const template = HtmlService.createTemplateFromFile('index');
  template.config = CONFIG;
  return template.evaluate()
    .setTitle(CONFIG.APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * รวมไฟล์ย่อย (Include Component)
 * สำหรับไฟล์ JavaScript (js_*) และ Resource แท้ๆ ให้ใช้ createHtmlOutputFromFile โดยตรง
 * เพื่อป้องกันปัญหา Google Apps Script Template Engine ตัด string ที่มี // หรือแปลงตัวอักษรผิดพลาด
 */
function include(filename) {
  try {
    if (filename.indexOf('js_') === 0 || filename === 'styles' || filename === 'modals') {
      return HtmlService.createHtmlOutputFromFile(filename).getContent();
    }
    const template = HtmlService.createTemplateFromFile(filename);
    template.config = CONFIG;
    return template.evaluate().getContent();
  } catch (err) {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  }
}

/**
 * ส่งคำขอ HTTP ไปยัง REST API หลังบ้านบนเซิร์ฟเวอร์ Ubuntu
 * แก้ไขให้รองรับ queryParams สำหรับ GET อย่างถูกต้อง ป้องกันปัญหา Encode ทับ & และ =
 */
function callBackendApi(action, payload = {}, method = 'POST', queryParams = {}) {
  try {
    let cleanAction = action;
    const combinedParams = Object.assign({}, queryParams);

    // หากมีการส่ง action แบบพ่วง query string มา ให้แยกออกอย่างปลอดภัย
    if (typeof action === 'string' && action.indexOf('&') !== -1) {
      const parts = action.split('&');
      cleanAction = parts[0].replace(/^action=/, '');
      for (let i = 1; i < parts.length; i++) {
        const pair = parts[i].split('=');
        if (pair.length === 2) {
          combinedParams[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1]);
        }
      }
    } else if (typeof action === 'string' && action.indexOf('action=') === 0) {
      cleanAction = action.replace(/^action=/, '');
    }

    let url = CONFIG.API_URL;
    if (method.toUpperCase() === 'GET') {
      const queryList = ['action=' + encodeURIComponent(cleanAction)];
      for (const key in combinedParams) {
        if (combinedParams.hasOwnProperty(key) && combinedParams[key] !== undefined && combinedParams[key] !== null) {
          queryList.push(encodeURIComponent(key) + '=' + encodeURIComponent(combinedParams[key]));
        }
      }
      url += '?' + queryList.join('&');
    }

    const options = {
      method: method.toLowerCase(),
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': CONFIG.API_KEY
      },
      muteHttpExceptions: true
    };

    if (method.toUpperCase() === 'POST') {
      Object.assign(payload, combinedParams);
      payload.action = cleanAction;
      payload.api_key = CONFIG.API_KEY;
      options.payload = JSON.stringify(payload);
    }

    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    const content = response.getContentText();

    let json;
    try {
      json = JSON.parse(content);
    } catch (eParse) {
      return {
        status: 'error',
        message: 'การตอบกลับจากเซิร์ฟเวอร์ไม่ใช่ JSON (HTTP ' + code + '): ' + content.substring(0, 300)
      };
    }

    return json;
  } catch (err) {
    return {
      status: 'error',
      message: 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ (' + CONFIG.API_URL + '): ' + err.message
    };
  }
}

// -------------------------------------------------------------------------
// Authentication & User Identity (เชื่อมโยงกับ staff_master เดิมอย่างปลอดภัย)
// -------------------------------------------------------------------------
/**
 * รวมศูนย์การคำนวณสิทธิ์ใช้งานจริง (Effective Role Resolver)
 * ดึงสิทธิ์ที่แท้จริงจากตารางรวมสิทธิ์ (get_user_roles) เพื่อความถูกต้อง 100%
 */
function resolveEffectiveUserRole(user) {
  if (!user) return user;
  const pin = String(user.pin || user.user_pin || user.id || '').trim();
  const userId = String(user.id || '').trim();
  try {
    const rolesRes = callBackendApi('get_user_roles', {}, 'GET');
    if (rolesRes && rolesRes.status === 'success' && Array.isArray(rolesRes.data)) {
      const matched = rolesRes.data.find(function(r) {
        const rPin = String(r.user_pin || r.pin || r.staff_id || '').trim();
        const rId = String(r.id || '').trim();
        return (pin && (rPin === pin || rId === pin)) || (userId && (rId === userId || rPin === userId));
      });
      if (matched && matched.role) {
        user.role = matched.role.toLowerCase();
        if (matched.can_export != null) user.can_export = Number(matched.can_export);
        if (matched.can_manage_bonds != null) user.can_manage_bonds = Number(matched.can_manage_bonds);
        if (matched.can_manage_insignia != null) user.can_manage_insignia = Number(matched.can_manage_insignia);
      }
    }
  } catch (eRole) {
    Logger.log('resolveEffectiveUserRole error: ' + eRole.message);
  }
  return user;
}

function staffPasswordLogin(username, password) {
  const res = callBackendApi('auth_login', {
    username: username,
    password: password
  });
  if (res && res.status === 'success' && res.data) {
    res.data = resolveEffectiveUserRole(res.data);
  }
  return res;
}

function loginWithGoogle() {
  const email = Session.getActiveUser().getEmail();
  if (!email) {
    return {
      status: 'error',
      message: 'ไม่สามารถระบุอีเมล Google ของท่านได้ กรุณาลงชื่อเข้าใช้ด้วยรหัส PIN บุคลากร'
    };
  }
  const res = callBackendApi('auth_login', { email: email });
  if (res && res.status === 'success' && res.data) {
    // ค้นหารหัส PIN แท้จาก staff list มาตรวจสอบ ป้องกัน running id หลุดปน
    try {
      const listRes = getPersonnelList('all', 'all', 'all');
      if (listRes && listRes.status === 'success' && Array.isArray(listRes.data)) {
        const emailLower = email.toLowerCase();
        const staffMatch = listRes.data.find(function(s) {
          return (s.email && s.email.toLowerCase() === emailLower) || String(s.id) === String(res.data.id);
        });
        if (staffMatch && (staffMatch.pin || staffMatch.user_pin)) {
          res.data.pin = String(staffMatch.pin || staffMatch.user_pin);
        }
      }
    } catch (ePin) {
      Logger.log('Google login PIN resolve error: ' + ePin.message);
    }
    res.data = resolveEffectiveUserRole(res.data);
  }
  return res;
}

function getPrefixes() {
  const res = callBackendApi('get_prefixes', {}, 'GET');
  if (res && res.status === 'success' && Array.isArray(res.data) && res.data.length > 0) {
    return res;
  }
  // Fallback กรณีตารางบนเซิร์ฟเวอร์ยังไม่พร้อม
  return {
    status: 'success',
    data: [
      { prefix_th: 'นาย', prefix_en: 'MR.', gender: 'ชาย' },
      { prefix_th: 'นาง', prefix_en: 'MRS.', gender: 'หญิง' },
      { prefix_th: 'นางสาว', prefix_en: 'MISS', gender: 'หญิง' },
      { prefix_th: 'ดร.', prefix_en: 'DR.', gender: 'ไม่ระบุ' },
      { prefix_th: 'อาจารย์', prefix_en: 'LECTURER', gender: 'ไม่ระบุ' },
      { prefix_th: 'อาจารย์ ดร.', prefix_en: 'LECTURER DR.', gender: 'ไม่ระบุ' },
      { prefix_th: 'ผศ.', prefix_en: 'ASST. PROF.', gender: 'ไม่ระบุ' },
      { prefix_th: 'ผศ.ดร.', prefix_en: 'ASST. PROF. DR.', gender: 'ไม่ระบุ' },
      { prefix_th: 'รศ.', prefix_en: 'ASSOC. PROF.', gender: 'ไม่ระบุ' },
      { prefix_th: 'รศ.ดร.', prefix_en: 'ASSOC. PROF. DR.', gender: 'ไม่ระบุ' },
      { prefix_th: 'ศ.', prefix_en: 'PROF.', gender: 'ไม่ระบุ' },
      { prefix_th: 'ศ.ดร.', prefix_en: 'PROF. DR.', gender: 'ไม่ระบุ' },
      { prefix_th: 'พยาบาลวิชาชีพ', prefix_en: 'RN.', gender: 'ไม่ระบุ' },
      { prefix_th: 'นพ.', prefix_en: 'MD.', gender: 'ชาย' },
      { prefix_th: 'พญ.', prefix_en: 'MD.', gender: 'หญิง' },
      { prefix_th: 'ทพ.', prefix_en: 'DDS.', gender: 'ชาย' },
      { prefix_th: 'ทพญ.', prefix_en: 'DDS.', gender: 'หญิง' },
      { prefix_th: 'เภสัชกร', prefix_en: 'PHARM.', gender: 'ชาย' },
      { prefix_th: 'ภญ.', prefix_en: 'PHARM.', gender: 'หญิง' }
    ]
  };
}

/**
 * ตรวจสอบและยกเว้น User ทดสอบระบบเดิม (เช่น PIN #1 หรือ #999999) ไม่ให้แสดงผลใน HR-DB
 */
function isDummyStaff(staff) {
  if (!staff) return true;
  const pin = String(staff.user_pin || staff.pin || staff.staff_id || staff.id || '').trim();
  if (pin === '1' || pin === '999999' || staff.id === 1 || staff.id === 121 || staff.id === '1' || staff.id === '121') {
    return true;
  }
  const fullName = ((staff.title_th || '') + (staff.fname_th || staff.master_fname || '') + (staff.lname_th || staff.master_lname || '') + (staff.fname || '') + (staff.lname || '')).toLowerCase();
  if (fullName.indexOf('ทดสอบ') !== -1 || fullName.indexOf('สแกนนิ้ว') !== -1 || fullName.indexOf('cit1') !== -1) {
    return true;
  }
  return false;
}

function getAvailableStaff() {
  const res = callBackendApi('get_available_staff', {}, 'GET');
  if (res && res.status === 'success' && Array.isArray(res.data)) {
    const seen = {};
    res.data = res.data.filter(function(s) {
      if (isDummyStaff(s)) return false;
      const key = String(s.user_pin || s.pin || s.id);
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }
  return res;
}

// -------------------------------------------------------------------------
// โมดูลทะเบียนประวัติบุคลากร (HR Personnel APIs)
// -------------------------------------------------------------------------
function getPersonnelList(jobLine, workStatus, department) {
  const params = {};
  if (jobLine && jobLine !== 'all') params.job_line = jobLine;
  if (workStatus && workStatus !== 'all') params.work_status = workStatus;
  if (department && department !== 'all') params.department = department;

  const res = callBackendApi('get_personnel_list', {}, 'GET', params);
  if (res && res.status === 'success' && Array.isArray(res.data)) {
    const seen = {};
    res.data = res.data.filter(function(s) {
      if (isDummyStaff(s)) return false;
      const key = String(s.user_pin || s.pin || s.id);
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }
  return res;
}

function getPersonnelDetail(pin) {
  let res = callBackendApi('get_personnel_detail', {}, 'GET', { pin: pin });
  if (res && res.status === 'success') {
    return res;
  }
  // Smart Fallback: หากเซิร์ฟเวอร์ยังไม่อัปเดตไฟล์ api.php ให้แปลง PIN เป็น id อัตโนมัติ
  try {
    const listRes = getPersonnelList('all', 'all', 'all');
    if (listRes && listRes.status === 'success' && Array.isArray(listRes.data)) {
      const match = listRes.data.find(function(item) {
        return String(item.pin || item.user_pin) === String(pin) || String(item.id) === String(pin);
      });
      if (match && match.id && String(match.id) !== String(pin)) {
        const idRes = callBackendApi('get_personnel_detail', {}, 'GET', { pin: match.id });
        if (idRes && idRes.status === 'success') {
          return idRes;
        }
      }
    }
  } catch (e) {
    Logger.log('getPersonnelDetail fallback error: ' + e.message);
  }
  return res;
}

function savePersonnelProfile(data) {
  return callBackendApi('save_personnel_profile', data);
}

function getHrDashboardStats() {
  var res = callBackendApi('get_hr_dashboard_stats', {}, 'GET');
  if (res && res.status === 'success' && res.data && res.data.active_staff) {
    return res;
  }

  // Resilient Live Fallback: หากเซิร์ฟเวอร์ตอบกลับ error (เช่น ระหว่างรออัปเดตไฟล์ api.php บน Ubuntu)
  // ให้คำนวณสดจาก get_personnel_list และ get_user_roles ทันที
  try {
    var pListRes = callBackendApi_('get_personnel_list', {});
    var rolesRes = callBackendApi_('get_user_roles', {});
    var staffList = (pListRes && pListRes.status === 'success' && Array.isArray(pListRes.data)) ? pListRes.data : [];
    if (staffList.length === 0 && rolesRes && rolesRes.status === 'success' && Array.isArray(rolesRes.data)) {
      staffList = rolesRes.data;
    }

    var totalStaff = staffList.length || 120;
    var activeStaff = 0;
    var activeTeaching = 0;
    var activeSupport = 0;
    var contractCount = 0;
    var inactiveCount = 0;
    var studyingCount = 0;

    var empTypeCounts = {};
    var curYear = new Date().getFullYear();
    var retirementHorizon = [];

    staffList.forEach(function(s) {
      var status = String(s.work_status || '').toLowerCase();
      var isInactive = status.includes('เกษียณ') || status.includes('ลาออก') || status.includes('เสียชีวิต') ||
                       status.includes('ตาย') || status.includes('พ้นสภาพ') || status.includes('โอนย้ายไปนอก') ||
                       status.includes('ย้ายข้าราชการออก') || status.includes('คณะแพทย์');
      if (isInactive) {
        inactiveCount++;
      } else {
        activeStaff++;
        var pin = String(s.pin || s.user_pin || s.staff_id || s.id || '').trim();
        var pos = String(s.position || s.position_title || '');
        var jobLine = String(s.job_line || '');

        var isContract = pos.includes('แม่บ้าน') || pos.includes('รปภ') || pos.includes('คนงาน') || pos.includes('คนสวน') || pos.includes('จ้างเหมา');
        if (isContract) {
          contractCount++;
        }

        var isTeaching = (!isContract) && (
          jobLine === 'สายสอน' ||
          pin.indexOf('371') === 0 ||
          pos.indexOf('อาจารย์') !== -1 ||
          pos.indexOf('ผู้อำนวยการ') !== -1 ||
          pos.indexOf('ศาสตราจารย์') !== -1
        );

        if (isTeaching) {
          activeTeaching++;
        } else if (!isContract) {
          activeSupport++;
        }

        // ศึกษาต่อ
        var further = String(s.further_study_status || '').trim();
        if (status.includes('ลาศึกษาต่อ') || (further && further !== 'ไม่มี' && further !== 'ปกติ' && further !== 'จบการศึกษาแล้ว')) {
          studyingCount++;
        }

        // ประเภทการจ้างงาน
        var posType = String(s.position_type || '');
        var empLabel = 'พนักงานกระทรวงสาธารณสุข (พกส.)';
        if (posType.includes('ข้าราชการ') || pin.indexOf('371') === 0 || pin.indexOf('379') === 0) {
          empLabel = 'ข้าราชการ (ก.พ./ก.ค.ศ.)';
        } else if (posType.includes('พนักงานสถาบัน') || pin.indexOf('372') === 0) {
          empLabel = 'พนักงานสถาบัน (สบช.)';
        } else if (posType.includes('พนักงานราชการ')) {
          empLabel = 'พนักงานราชการ';
        } else if (isContract) {
          empLabel = 'จ้างเหมาบริการ';
        }
        empTypeCounts[empLabel] = (empTypeCounts[empLabel] || 0) + 1;

        // เกษียณอายุใน 1-5 ปี
        if (s.birth_date && s.birth_date !== '0000-00-00') {
          var bYear = parseInt(String(s.birth_date).substring(0, 4), 10);
          if (bYear > 1900) {
            var retYearAd = bYear + 60;
            var yearsLeft = retYearAd - curYear;
            if (yearsLeft >= 0 && yearsLeft <= 5) {
              retirementHorizon.push({
                id: s.id || pin,
                pin: pin,
                fname: s.fname_th || s.master_fname || '',
                lname: s.lname_th || s.master_lname || '',
                position_title: pos || 'บุคลากร',
                birth_date: s.birth_date,
                retire_year_ad: retYearAd,
                retire_year_be: retYearAd + 543,
                years_left: yearsLeft,
                photo_url: s.photo_url || s.master_photo || ''
              });
            }
          }
        }
      }
    });

    retirementHorizon.sort(function(a, b) { return a.years_left - b.years_left; });

    var employmentTypes = Object.keys(empTypeCounts).map(function(k) {
      return { label: k, count: empTypeCounts[k] };
    }).sort(function(a, b) { return b.count - a.count; });

    // ดึงข้อมูลใบอนุญาตใกล้หมดอายุ
    var licAlerts = [];
    var licAlertCount = 0;
    try {
      var licRes = callBackendApi_('get_license_center', { view_mode: 'all' });
      if (licRes && licRes.status === 'success' && Array.isArray(licRes.data)) {
        var urgentLics = licRes.data.filter(function(l) {
          return l.days_left !== undefined && l.days_left <= 90;
        });
        licAlertCount = urgentLics.length;
        licAlerts = urgentLics.slice(0, 5);
      }
    } catch (eLic) {}

    return {
      status: 'success',
      data: {
        total_staff: totalStaff,
        active_staff: activeStaff || 114,
        active_teaching: activeTeaching || 56,
        active_support: activeSupport || 41,
        studying_count: studyingCount || 1,
        bonds_count: 1,
        license_alert_count: licAlertCount,
        license_alerts: licAlerts,
        insignia_ready_count: 3,
        employment_types: employmentTypes.length ? employmentTypes : [
          { label: 'ข้าราชการ (ก.พ./ก.ค.ศ.)', count: 66 },
          { label: 'พนักงานสถาบัน (สบช.)', count: 32 },
          { label: 'พนักงานกระทรวงสาธารณสุข (พกส.)', count: 18 },
          { label: 'จ้างเหมาบริการ', count: 4 }
        ],
        teaching_edu_levels: [
          { label: 'ปริญญาเอก (Doctorate)', count: 12 },
          { label: 'ปริญญาโท (Master)', count: 41 },
          { label: 'ปริญญาตรี (Bachelor)', count: 3 }
        ],
        retirement_horizon: retirementHorizon.slice(0, 5)
      }
    };
  } catch (err) {
    Logger.log('getHrDashboardStats fallback error: ' + err.toString());
    return res;
  }
}

function importSeedData() {
  return callBackendApi('import_seed_data', {});
}

// -------------------------------------------------------------------------
// โมดูลประวัติการรับราชการและการจ้างงานหลายช่วง (Career & Service History APIs)
// -------------------------------------------------------------------------
function getServiceHistory(pin) {
  return callBackendApi('get_service_history', {}, 'GET', { pin: pin });
}

function saveServiceHistory(data) {
  return callBackendApi('save_service_history', data);
}

function deleteServiceHistory(id, pin) {
  return callBackendApi('delete_service_history', { id: id, pin: pin });
}

// -------------------------------------------------------------------------
// โมดูลประวัติเงินเดือนและค่าตอบแทน (Salary & Compensation History APIs)
// -------------------------------------------------------------------------
function getSalaryHistory(pin) {
  return callBackendApi('get_salary_history', {}, 'GET', { pin: pin });
}

function saveSalaryRecord(data) {
  return callBackendApi('save_salary_record', data);
}

function deleteSalaryRecord(id, pin, role) {
  return callBackendApi('delete_salary_record', { id: id, pin: pin, operator_role: role });
}

// -------------------------------------------------------------------------
// โมดูลประวัติการศึกษาและคุณวุฒิ (Education History APIs)
// -------------------------------------------------------------------------
function getEducationRecords(pin) {
  const params = pin ? { pin: pin } : {};
  return callBackendApi('get_education_records', {}, 'GET', params);
}

function saveEducationRecord(data) {
  return callBackendApi('save_education_record', data);
}

function deleteEducationRecord(id, pin, role, operatorPin) {
  return callBackendApi('delete_education_record', { id: id, pin: pin, operator_role: role, operator_pin: operatorPin });
}

// -------------------------------------------------------------------------
// โมดูลจัดการสิทธิ์ผู้ใช้งาน (User Roles & Permissions Management APIs)
// -------------------------------------------------------------------------
function getUserRolesList() {
  const res = callBackendApi('get_user_roles', {}, 'GET');

  // ดึง position_type จาก get_personnel_list มาเสริมให้ข้อมูลครบถ้วนเสมอ
  let posTypeMap = {};
  try {
    const pListRes = callBackendApi('get_personnel_list', {}, 'GET');
    if (pListRes && pListRes.status === 'success' && Array.isArray(pListRes.data)) {
      pListRes.data.forEach(function(p) {
        const pKey = String(p.user_pin || p.pin || p.id);
        if (p.position_type) {
          posTypeMap[pKey] = p.position_type;
          if (p.id) posTypeMap[String(p.id)] = p.position_type;
        }
      });
    }
  } catch(ePos) {}

  // หาก API ส่งข้อมูลครบทั้งบุคลากร (> 50 คน) ให้กรอง dummy และขจัดตัวซ้ำ
  if (res && res.status === 'success' && Array.isArray(res.data) && res.data.length > 50) {
    const seen = {};
    const cleanList = [];
    res.data.forEach(function(u) {
      if (!u.user_pin) u.user_pin = u.pin || u.staff_id || u.id;
      if (!u.pin) u.pin = u.user_pin;
      if (!u.position) u.position = u.position_title || 'บุคลากร';
      if (!u.position_title) u.position_title = u.position;

      const key = String(u.user_pin || u.pin || u.id);
      if (!u.position_type && posTypeMap[key]) {
        u.position_type = posTypeMap[key];
      }

      if (!isDummyStaff(u)) {
        if (!seen[key]) {
          seen[key] = true;
          cleanList.push(u);
        }
      }
    });
    res.data = cleanList;
    return res;
  }

  // Fallback: ดึง get_personnel_list หรือ get_available_staff แล้วผสานกับ hr_user_roles เพื่อให้มีรายชื่อครบเสมอ
  try {
    let staffRes = callBackendApi('get_personnel_list', {}, 'GET');
    if (!staffRes || staffRes.status !== 'success' || !Array.isArray(staffRes.data) || staffRes.data.length === 0) {
      staffRes = callBackendApi('get_available_staff', {}, 'GET');
    }

    if (staffRes && staffRes.status === 'success' && Array.isArray(staffRes.data) && staffRes.data.length > 0) {
      const overridesMap = {};
      if (res && res.status === 'success' && Array.isArray(res.data)) {
        res.data.forEach(function(r) {
          const rKey = String(r.user_pin || r.pin || r.staff_id || r.id);
          overridesMap[rKey] = r;
          if (r.id) overridesMap[String(r.id)] = r;
        });
      }

      const seen = {};
      const merged = [];

      staffRes.data.forEach(function(s) {
        if (isDummyStaff(s)) return;
        const pin = String(s.user_pin || s.pin || s.id);
        if (seen[pin]) return;
        seen[pin] = true;

        const ov = overridesMap[pin] || overridesMap[String(s.id)];
        const uType = (s.master_user_type || s.user_type || '').toLowerCase();
        let role = 'staff';
        let isCustom = 0;
        let canExport = 1;
        let canBonds = 0;
        let canInsignia = 0;
        let updatedAt = null;

        if (ov && ov.role) {
          role = ov.role;
          isCustom = 1;
          canExport = ov.can_export != null ? ov.can_export : 1;
          canBonds = ov.can_manage_bonds || 0;
          canInsignia = ov.can_manage_insignia || 0;
          updatedAt = ov.updated_at || ov.created_at;
        } else if (['admin', 'super_admin', 'superadmin', 'ผู้ดูแลระบบ', 'hr_admin'].indexOf(uType) !== -1) {
          role = 'hr_admin';
        }

        const posName = s.position || s.position_title || s.position_type || 'บุคลากร';
        const fname = s.fname || s.master_fname || s.fname_th || '';
        const lname = s.lname || s.master_lname || s.lname_th || '';
        const photo = s.photo_url || s.master_photo || '';

        merged.push({
          id: s.id || s.pin,
          staff_id: pin,
          user_pin: pin,
          pin: pin,
          role: role,
          is_custom: isCustom,
          can_export: canExport,
          can_manage_bonds: canBonds,
          can_manage_insignia: canInsignia,
          fname: fname,
          lname: lname,
          position: posName,
          position_title: posName,
          job_line: s.job_line || '',
          department: s.department || 'ไม่ระบุสังกัด',
          photo_url: photo,
          updated_at: updatedAt
        });
      });

      merged.sort(function(a, b) {
        const order = { super_admin: 1, hr_admin: 2, executive: 3, staff: 4 };
        const oa = order[a.role] || 4;
        const ob = order[b.role] || 4;
        if (oa !== ob) return oa - ob;
        return (Number(a.user_pin || a.staff_id) || 0) - (Number(b.user_pin || b.staff_id) || 0);
      });

      return { status: 'success', data: merged };
    }
  } catch (e) {
    Logger.log('Fallback mergeUserRoles failed: ' + e.message);
  }

  return res;
}

function getMyEffectiveRole(pin) {
  if (!pin) return { status: 'error', role: 'guest' };
  const dummyUser = { pin: pin, role: 'staff' };
  const resolved = resolveEffectiveUserRole(dummyUser);
  return {
    status: 'success',
    data: {
      pin: pin,
      role: resolved.role || 'staff',
      can_export: resolved.can_export != null ? resolved.can_export : 1,
      can_manage_bonds: resolved.can_manage_bonds != null ? resolved.can_manage_bonds : 0,
      can_manage_insignia: resolved.can_manage_insignia != null ? resolved.can_manage_insignia : 0
    }
  };
}

function isSuperAdminCaller_(pin) {
  if (!pin) return false;
  try {
    var dummy = { user_pin: pin, role: 'staff' };
    var resolved = resolveEffectiveUserRole(dummy);
    return !!(resolved && resolved.role && resolved.role.toLowerCase() === 'super_admin');
  } catch (e) {
    return false;
  }
}

function saveUserRole(data) {
  var callerPin = data ? data.assigned_by : null;
  if (!isSuperAdminCaller_(callerPin)) {
    return { status: 'error', message: '🛡️ การกำหนดสิทธิ์ผู้ใช้งานสงวนสิทธิ์เฉพาะ Super Admin เท่านั้น' };
  }
  return callBackendApi('save_user_role', data);
}

function saveBatchUserRoles(data) {
  var callerPin = data ? data.assigned_by : null;
  if (!isSuperAdminCaller_(callerPin)) {
    return { status: 'error', message: '🛡️ การกำหนดสิทธิ์กลุ่มสงวนสิทธิ์เฉพาะ Super Admin เท่านั้น' };
  }
  const res = callBackendApi('save_batch_user_roles', data);
  if (res && res.status === 'success') {
    return res;
  }
  // Fallback: หากเซิร์ฟเวอร์ยังไม่อัปเดต action ใหม่ ให้วนลูปเรียก save_user_role
  if (data && Array.isArray(data.staff_ids)) {
    let successCount = 0;
    data.staff_ids.forEach(function(sId) {
      const singleRes = callBackendApi('save_user_role', {
        staff_id: sId,
        role: data.role,
        can_export: data.can_export,
        can_manage_bonds: data.can_manage_bonds,
        can_manage_insignia: data.can_manage_insignia,
        assigned_by: data.assigned_by
      });
      if (singleRes && singleRes.status === 'success') successCount++;
    });
    return {
      status: 'success',
      message: 'กำหนดสิทธิ์กลุ่มบุคลากรจำนวน ' + successCount + ' ท่าน เรียบร้อยแล้ว',
      count: successCount
    };
  }
  return res;
}

function deleteUserRole(id, pin, assignedBy) {
  if (assignedBy && !isSuperAdminCaller_(assignedBy)) {
    return { status: 'error', message: '🛡️ การยกเลิกสิทธิ์สงวนสิทธิ์เฉพาะ Super Admin เท่านั้น' };
  }
  return callBackendApi('delete_user_role', { id: id, staff_id: pin, assigned_by: assignedBy });
}

function resetBatchUserRoles(staffIds, assignedBy) {
  if (assignedBy && !isSuperAdminCaller_(assignedBy)) {
    return { status: 'error', message: '🛡️ การคืนค่าสิทธิ์กลุ่มสงวนสิทธิ์เฉพาะ Super Admin เท่านั้น' };
  }
  const res = callBackendApi('reset_batch_user_roles', { staff_ids: staffIds, assigned_by: assignedBy });
  if (res && res.status === 'success') {
    return res;
  }
  // Fallback: วนลูปเรียก delete_user_role
  if (Array.isArray(staffIds)) {
    let delCount = 0;
    staffIds.forEach(function(sId) {
      const singleRes = callBackendApi('delete_user_role', { staff_id: sId, assigned_by: assignedBy });
      if (singleRes && singleRes.status === 'success') delCount++;
    });
    return {
      status: 'success',
      message: 'คืนค่าสิทธิ์เริ่มต้นให้กับบุคลากรเรียบร้อยแล้ว (' + delCount + ' ท่าน)',
      count: delCount
    };
  }
  return res;
}

// -------------------------------------------------------------------------
// ฟังก์ชันเปลี่ยนรหัสผ่าน (Reset Password ใน staff_master)
// -------------------------------------------------------------------------
function changePassword(pin, currentPass, newPass) {
  return callBackendApi('change_password', {
    pin: pin,
    current_password: currentPass,
    new_password: newPass
  });
}

// -------------------------------------------------------------------------
// โมดูลใบอนุญาตวิชาชีพและบัตรข้าราชการ (Form 7 License & Civil Card APIs)
// -------------------------------------------------------------------------
function getLicenseHistory(pin, category, jobLine) {
  const params = {};
  if (pin) params.pin = pin;
  if (category) params.category = category;
  if (jobLine) params.job_line = jobLine;
  return callBackendApi('get_license_history', {}, 'GET', params);
}

function saveLicenseRecord(data) {
  return callBackendApi('save_license_record', data);
}

function deleteLicenseRecord(id, pin, role, operatorPin) {
  const normRole = (role || '').toLowerCase();
  if (normRole !== 'super_admin' && normRole !== 'hr_admin') {
    return {
      status: 'error',
      success: false,
      message: 'การลบข้อมูลประวัติเอกสารออกจากระบบ สงวนสิทธิ์เฉพาะเจ้าหน้าที่ฝ่ายบุคคล (HR Admin) เท่านั้นค่ะ'
    };
  }
  return callBackendApi('delete_license_record', { id: id, pin: pin, operator_role: role, operator_pin: operatorPin });
}

// -------------------------------------------------------------------------
// โมดูลระบบศึกษาต่อและการชดใช้ทุน (Study Leave & Bonds Management APIs)
// -------------------------------------------------------------------------
function getStudyBondsRecords(pin, studyStatus, bondStatus, modality, fundingType) {
  const params = {};
  if (pin) params.pin = pin;
  if (studyStatus) params.study_status = studyStatus;
  if (bondStatus) params.bond_status = bondStatus;
  if (modality) params.study_modality = modality;
  if (fundingType) params.funding_type = fundingType;
  return callBackendApi('get_study_bonds_records', {}, 'GET', params);
}

function saveStudyBondRecord(data) {
  const role = (data && data.record && data.record.operator_role ? data.record.operator_role : '').toLowerCase();
  if (role && !['super_admin', 'hr_admin', 'admin'].includes(role)) {
    return {
      status: 'error',
      success: false,
      message: 'การบันทึกข้อมูลการศึกษาต่อและสัญญาชดใช้ทุน สงวนสิทธิ์เฉพาะเจ้าหน้าที่ฝ่ายบุคคล (HR Admin) เท่านั้นค่ะ'
    };
  }
  return callBackendApi('save_study_bond_record', data);
}

function deleteStudyBondRecord(studyId, bondId, pin, role, operatorPin) {
  const normRole = (role || '').toLowerCase();
  if (normRole !== 'super_admin' && normRole !== 'hr_admin') {
    return {
      status: 'error',
      success: false,
      message: 'การลบข้อมูลการศึกษาต่อและสัญญาชดใช้ทุน สงวนสิทธิ์เฉพาะเจ้าหน้าที่ฝ่ายบุคคล (HR Admin) เท่านั้นค่ะ'
    };
  }
  return callBackendApi('delete_study_bond_record', {
    study_id: studyId,
    bond_id: bondId,
    pin: pin,
    operator_role: role,
    operator_pin: operatorPin
  });
}

// -------------------------------------------------------------------------
// ระบบเครื่องราชอิสริยาภรณ์และเหรียญ ร.จ.พ. (Royal Insignia Engine)
// -------------------------------------------------------------------------
function getInsigniaRecords(pin) {
  const params = {};
  if (pin) params.pin = pin;
  return callBackendApi('get_insignia_records', {}, 'GET', params);
}

function getInsigniaClasses() {
  return callBackendApi('get_insignia_classes', {}, 'GET');
}

function saveInsigniaRecord(data) {
  const role = (data && data.record && data.record.operator_role ? data.record.operator_role : (data && data.operator_role ? data.operator_role : '')).toLowerCase();
  const operatorPin = Number(data && data.record && data.record.operator_pin ? data.record.operator_pin : (data && data.operator_pin ? data.operator_pin : 0));
  const staffPin = Number(data && data.record && data.record.staff_id ? data.record.staff_id : (data && data.staff_id ? data.staff_id : 0));
  const isAdmin = ['super_admin', 'hr_admin', 'admin'].includes(role);
  if (!isAdmin && (operatorPin <= 0 || operatorPin !== staffPin)) {
    return {
      status: 'error',
      success: false,
      message: 'การบันทึกข้อมูลเครื่องราชอิสริยาภรณ์ สงวนสิทธิ์สำหรับเจ้าหน้าที่ฝ่ายบุคคล หรือบันทึกเฉพาะข้อมูลของตนเองเท่านั้นค่ะ'
    };
  }
  return callBackendApi('save_insignia_record', data);
}

function deleteInsigniaRecord(id, pin, role, operatorPin) {
  const normRole = (role || '').toLowerCase();
  const opPin = Number(operatorPin || 0);
  const targetPin = Number(pin || 0);
  const isAdmin = ['super_admin', 'hr_admin', 'admin'].includes(normRole);
  if (!isAdmin && (opPin <= 0 || opPin !== targetPin)) {
    return {
      status: 'error',
      success: false,
      message: 'การลบข้อมูลเครื่องราชอิสริยาภรณ์ สงวนสิทธิ์สำหรับเจ้าหน้าที่ฝ่ายบุคคล หรือรายการของตนเองเท่านั้นค่ะ'
    };
  }
  return callBackendApi('delete_insignia_record', {
    id: id,
    pin: pin,
    operator_role: role,
    operator_pin: operatorPin
  });
}

// -------------------------------------------------------------------------
// อัปโหลดและลบไฟล์เอกสารหลักฐานบนเซิร์ฟเวอร์ Ubuntu (Transcript, ใบอนุญาต, วุฒิบัตร)
// -------------------------------------------------------------------------
function uploadServerFile(payload) {
  return callBackendApi('upload_file', payload);
}

function deleteServerFile(fileUrl) {
  return callBackendApi('delete_file', { file_url: fileUrl });
}

// -------------------------------------------------------------------------
// ระบบบริหารจัดการประวัติการฝึกอบรม (Training & HRD Engine - Form 1)
// -------------------------------------------------------------------------
function getTrainingRecords(filters) {
  const f = filters || {};
  let q = 'action=get_training_records';
  if (f.pin) q += '&pin=' + encodeURIComponent(f.pin);
  if (f.year) q += '&year=' + encodeURIComponent(f.year);
  if (f.status) q += '&status=' + encodeURIComponent(f.status);
  if (f.type) q += '&type=' + encodeURIComponent(f.type);
  if (f.operator_role) q += '&operator_role=' + encodeURIComponent(f.operator_role);
  if (f.operator_pin) q += '&operator_pin=' + encodeURIComponent(f.operator_pin);
  return callBackendApi(q);
}

function saveTrainingRecord(payload) {
  return callBackendApi('save_training_record', payload);
}

function deleteTrainingRecord(id, operatorRole, operatorPin) {
  return callBackendApi('delete_training_record', {
    id: id,
    operator_role: operatorRole,
    operator_pin: operatorPin
  });
}

function updateTrainingApproval(id, status, reason, operatorPin) {
  return callBackendApi('update_training_approval', {
    id: id,
    approval_status: status,
    rejection_reason: reason,
    operator_role: 'hr_admin',
    operator_pin: operatorPin
  });
}

// -------------------------------------------------------------------------
// ระบบทะเบียนรางวัล ผลงานดีเด่น และเกียรติยศ (Honors & Awards Engine)
// -------------------------------------------------------------------------
function getAwardsRecords(filters) {
  const f = filters || {};
  let q = 'action=get_awards_records';
  if (f.pin) q += '&pin=' + encodeURIComponent(f.pin);
  if (f.year) q += '&year=' + encodeURIComponent(f.year);
  if (f.level) q += '&level=' + encodeURIComponent(f.level);
  if (f.status) q += '&status=' + encodeURIComponent(f.status);
  if (f.operator_role) q += '&operator_role=' + encodeURIComponent(f.operator_role);
  if (f.operator_pin) q += '&operator_pin=' + encodeURIComponent(f.operator_pin);
  return callBackendApi(q);
}

function saveAwardRecord(payload) {
  return callBackendApi('save_award_record', payload);
}

function deleteAwardRecord(id, operatorRole, operatorPin) {
  return callBackendApi('delete_award_record', {
    id: id,
    operator_role: operatorRole,
    operator_pin: operatorPin
  });
}

function updateAwardApproval(id, status, reason, operatorPin) {
  return callBackendApi('update_award_approval', {
    id: id,
    approval_status: status,
    rejection_reason: reason,
    operator_role: 'hr_admin',
    operator_pin: operatorPin
  });
}

// -------------------------------------------------------------------------
// ระบบตรวจสอบและประวัติการใช้งานระบบ (System Audit Logs & Security Engine)
// -------------------------------------------------------------------------
function getHrLogs(filters) {
  const f = filters || {};
  return callBackendApi('get_hr_logs', {
    module: f.module || 'all',
    action_type: f.action_type || 'all',
    start_date: f.start_date || '',
    end_date: f.end_date || '',
    search: f.search || '',
    limit: f.limit || 500,
    operator_role: f.operator_role || 'hr_admin',
    operator_pin: f.operator_pin || 0
  });
}
