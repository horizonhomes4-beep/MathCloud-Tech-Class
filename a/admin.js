//==================================================
// Lesson Payment Management System
// Admin Dashboard
//==================================================

import {
    db,
    teachersRef,
    studentsRef,
    paymentsRef,
    ref,
    push,
    set,
    update,
    remove,
    onValue
} from "./firebase.js";

import { printStudentReceipt } from "./receipt.js";

//==================================================
// DOM ELEMENTS
//==================================================

const teacherTable = document.getElementById("teacherTable");
const studentTable = document.getElementById("studentTable");
const paymentTable = document.getElementById("paymentTable");

const teacherCount = document.getElementById("teacherCount");
const studentCount = document.getElementById("studentCount");

const expectedTotal = document.getElementById("expectedTotal");
const paidTotal = document.getElementById("paidTotal");
const balanceTotal = document.getElementById("balanceTotal");

const teacherSearch = document.getElementById("teacherSearch");
const studentSearch = document.getElementById("studentSearch");

//==================================================
// MODALS
//==================================================

const teacherModal = document.getElementById("teacherModal");
const studentModal = document.getElementById("studentModal");
const paymentModal = document.getElementById("paymentModal");
const dashboardModal = document.getElementById("dashboardModal");
const teacherViewModal = document.getElementById("teacherViewModal");
const deleteModal = document.getElementById("deleteModal");

//==================================================
// STATE
//==================================================

let teachers = {};
let students = {};
let payments = {};
let customPrograms = {};

// A sensible starting set — admins can add any additional program from the
// dropdown itself ("+ Add New Program..."), which is saved to Firebase so
// it shows up for everyone from then on, with no code changes needed.
const DEFAULT_PROGRAMS = [
    "CBT Assessment",
    "ICT Training (Certificate)",
    "Computer Skills",
    "Video Editing",
    "Website Development",
    "App Development",
    "Graphic Design",
    "Digital Marketing",
    "Data Analysis",
    "Software Engineering",
    "Networking Essentials",
    "Cybersecurity Basics"
];

const ADD_PROGRAM_VALUE = "__add_new_program__";
const programsRef = ref(db, "lessonPayment/programs");

let editingTeacherId = null;
let editingStudentId = null;

let deletePath = "";
let deleteType = ""; // "student" | "teacher"

// Students list pagination (show a handful at a time, toggle for the rest)
let studentsExpanded = false;
const STUDENT_PAGE_SIZE = 3;

//==================================================
// TOAST
//==================================================

function toast(message) {
    const box = document.getElementById("toast");
    const text = document.getElementById("toastMessage");
    text.textContent = message;
    box.classList.add("show");
    setTimeout(() => {
        box.classList.remove("show");
    }, 2500);
}

//==================================================
// FORMAT MONEY
//==================================================

function money(amount) {
    return "₦" + Number(amount || 0).toLocaleString();
}

function balanceBadge(value) {
    const num = Number(value || 0);
    const cls = num > 0 ? "badge-negative" : num < 0 ? "badge-positive" : "badge-neutral";
    return `<span class="balance-badge ${cls}">${money(num)}</span>`;
}

//==================================================
// ESCAPE HTML (basic safety for injected text)
//==================================================

function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value ?? "";
    return div.innerHTML;
}

//==================================================
// RANDOM DASHBOARD KEY
//==================================================

function generateKey() {
    return (
        Math.random().toString(36).substring(2, 10) +
        Math.random().toString(36).substring(2, 6)
    );
}

//==================================================
// MODAL OPEN / CLOSE HELPERS
//==================================================

function openTeacherModal(editId = null) {
    editingTeacherId = editId;

    const title = document.querySelector("#teacherModal .modal-header h2");
    const saveBtn = document.getElementById("saveTeacher");

    if (editId) {
        const t = teachers[editId];
        document.getElementById("teacherName").value = t.name || "";
        document.getElementById("teacherPhone").value = t.phone || "";
        document.getElementById("teacherAddress").value = t.address || "";
        title.textContent = "Edit Teacher";
        saveBtn.textContent = "Update Teacher";
    } else {
        document.getElementById("teacherName").value = "";
        document.getElementById("teacherPhone").value = "";
        document.getElementById("teacherAddress").value = "";
        title.textContent = "Add Teacher";
        saveBtn.textContent = "Save Teacher";
    }

    teacherModal.classList.add("active");
}

function closeTeacherModal() {
    teacherModal.classList.remove("active");
    editingTeacherId = null;
}

function openStudentModal(editId = null) {
    editingStudentId = editId;

    const title = document.querySelector("#studentModal .modal-header h2");
    const saveBtn = document.getElementById("saveStudent");
    const programSelect = document.getElementById("studentProgram");

    // New registration fields
    const emailInput = document.getElementById("studentEmail");
    const addressInput = document.getElementById("studentAddress");
    const sexSelect = document.getElementById("studentSex");
    const durationInput = document.getElementById("studentDuration");
    // Description is independent of the amount paid — just a free-text
    // note about the student, saved to Firebase alongside their record.
    const descriptionInput = document.getElementById("studentDescription");

    if (editId) {
        const s = students[editId];
        document.getElementById("studentName").value = s.name || "";
        programSelect.value = s.program || "";
        document.getElementById("startDate").value = s.startDate || "";
        document.getElementById("stopDate").value = s.stopDate || "";
        document.getElementById("amountPaid").value = s.amountPaid || "";
        teacherSelect.value = s.teacherId || "";

        if (emailInput) emailInput.value = s.email || "";
        if (addressInput) addressInput.value = s.address || "";
        if (sexSelect) sexSelect.value = s.sex || "";
        if (durationInput) durationInput.value = s.durationMonths || "";
        if (descriptionInput) descriptionInput.value = s.description || "";

        title.textContent = "Edit Student";
        saveBtn.textContent = "Update Student";
    } else {
        document.getElementById("studentName").value = "";
        programSelect.selectedIndex = 0;
        document.getElementById("startDate").value = "";
        document.getElementById("stopDate").value = "";
        document.getElementById("amountPaid").value = "";
        teacherSelect.selectedIndex = 0;

        if (emailInput) emailInput.value = "";
        if (addressInput) addressInput.value = "";
        if (sexSelect) sexSelect.selectedIndex = 0;
        if (durationInput) durationInput.value = "";
        if (descriptionInput) descriptionInput.value = "";

        title.textContent = "Add Student";
        saveBtn.textContent = "Save Student";
    }

    studentModal.classList.add("active");
}

function closeStudentModal() {
    studentModal.classList.remove("active");
    editingStudentId = null;
}

//==================================================
// BUTTON WIRING - OPEN
//==================================================

document.getElementById("addTeacherBtn").onclick = () => openTeacherModal();
document.getElementById("addStudentBtn").onclick = () => openStudentModal();
document.getElementById("paymentBtn").onclick = () => {
    paymentModal.classList.add("active");
};

//==================================================
// BUTTON WIRING - CANCEL / CLOSE
//==================================================

document.getElementById("cancelTeacher").onclick = closeTeacherModal;
document.getElementById("closeTeacherModal").onclick = closeTeacherModal;

document.getElementById("cancelStudent").onclick = closeStudentModal;
document.getElementById("closeStudentModal").onclick = closeStudentModal;

document.getElementById("cancelPayment").onclick = () => {
    paymentModal.classList.remove("active");
};
document.getElementById("closePaymentModal").onclick = () => {
    paymentModal.classList.remove("active");
};

document.getElementById("closeDashboardModal").onclick = () => {
    dashboardModal.classList.remove("active");
};

document.getElementById("closeTeacherViewModal").onclick = closeTeacherViewModal;

function closeTeacherViewModal() {
    teacherViewModal.classList.remove("active");
    document.getElementById("teacherViewFrame").src = "about:blank";
}

//==================================================
// REFRESH BUTTON
// (Data is already live via onValue, this just gives
// the user visible confirmation + resets filters)
//==================================================

document.getElementById("refreshBtn").onclick = () => {
    teacherSearch.value = "";
    studentSearch.value = "";
    studentsExpanded = false;
    renderTeachers();
    renderStudents();
    toast("Dashboard refreshed");
};

//==================================================
// ADD / UPDATE TEACHER
//==================================================

document.getElementById("saveTeacher").onclick = () => {
    const name = document.getElementById("teacherName").value.trim();
    const phone = document.getElementById("teacherPhone").value.trim();
    const address = document.getElementById("teacherAddress").value.trim();

    if (name === "") {
        toast("Enter teacher name");
        return;
    }

    if (editingTeacherId) {
        update(ref(db, "lessonPayment/teachers/" + editingTeacherId), {
            name,
            phone,
            address
        });
        toast("Teacher updated successfully");
    } else {
        const teacherId = push(teachersRef).key;
        const dashboardKey = generateKey();

        set(ref(db, "lessonPayment/teachers/" + teacherId), {
            name,
            phone,
            address,
            dashboardKey,
            createdAt: Date.now()
        });
        toast("Teacher added successfully");
    }

    closeTeacherModal();
};

//==================================================
// TEACHER SELECT ELEMENTS
//==================================================

const teacherSelect = document.getElementById("teacherSelect");
const paymentTeacher = document.getElementById("paymentTeacher");

//==================================================
// LOAD TEACHERS
//==================================================

onValue(teachersRef, (snapshot) => {
    teachers = snapshot.val() || {};
    populateTeacherDropdowns();
    renderTeachers();
    renderStudents();
    renderPayments();
    calculateTotals();
});

function populateTeacherDropdowns() {
    const currentTeacherSelectValue = teacherSelect.value;
    const currentPaymentTeacherValue = paymentTeacher.value;

    teacherSelect.innerHTML = '<option value="">Select Teacher</option>';
    paymentTeacher.innerHTML = '<option value="">Select Teacher</option>';

    Object.keys(teachers).forEach((id) => {
        const teacher = teachers[id];

        const option1 = document.createElement("option");
        option1.value = id;
        option1.textContent = teacher.name;
        teacherSelect.appendChild(option1);

        const option2 = option1.cloneNode(true);
        paymentTeacher.appendChild(option2);
    });

    teacherSelect.value = currentTeacherSelectValue;
    paymentTeacher.value = currentPaymentTeacherValue;
}

//==================================================
// PROGRAM OPTIONS (expandable list, stored in Firebase)
//==================================================

const studentProgramSelect = document.getElementById("studentProgram");

onValue(programsRef, (snapshot) => {
    customPrograms = snapshot.val() || {};
    populateProgramOptions();
});

function allProgramNames() {
    const extras = Object.values(customPrograms).filter((p) => !DEFAULT_PROGRAMS.includes(p));
    return [...DEFAULT_PROGRAMS, ...extras];
}

function populateProgramOptions(selectValue) {
    if (!studentProgramSelect) return;

    const keep = selectValue !== undefined ? selectValue : studentProgramSelect.value;

    studentProgramSelect.innerHTML = '<option value="">Select Program</option>';

    allProgramNames().forEach((name) => {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        studentProgramSelect.appendChild(option);
    });

    const addOption = document.createElement("option");
    addOption.value = ADD_PROGRAM_VALUE;
    addOption.textContent = "+ Add New Program...";
    studentProgramSelect.appendChild(addOption);

    studentProgramSelect.value = keep;
}

if (studentProgramSelect) {
    studentProgramSelect.addEventListener("change", () => {
        if (studentProgramSelect.value !== ADD_PROGRAM_VALUE) return;

        const entered = (prompt("Enter the new program/course name:") || "").trim();

        if (entered === "") {
            populateProgramOptions("");
            return;
        }

        if (!allProgramNames().some((p) => p.toLowerCase() === entered.toLowerCase())) {
            const newId = push(programsRef).key;
            set(ref(db, "lessonPayment/programs/" + newId), entered);
        }

        // onValue above will refresh the option list; keep the new value selected.
        setTimeout(() => populateProgramOptions(entered), 250);
    });
}

//==================================================
// RENDER TEACHERS (with search filter)
//==================================================

function renderTeachers() {
    const filter = (teacherSearch.value || "").trim().toLowerCase();

    teacherTable.innerHTML = "";
    let count = 0;
    let visibleCount = 0;

    Object.keys(teachers).forEach((id) => {
        count++;

        const teacher = teachers[id];

        if (filter && !teacher.name.toLowerCase().includes(filter)) {
            return;
        }

        visibleCount++;

        let studentCountForTeacher = 0;
        let expected = 0;

        // Expected earnings include every student ever assigned to this
        // teacher (even ones later removed) so deleting a student never
        // erases financial history already counted toward the teacher.
        Object.keys(students).forEach((studentId) => {
            const student = students[studentId];
            if (student.teacherId !== id) return;

            expected += Number(student.amountPaid || 0) / 3;
            if (!student.isDeleted) studentCountForTeacher++;
        });

        const received = acknowledgedReceivedForTeacher(id);
        const balance = expected - received;

        teacherTable.innerHTML += `
<tr>
<td>${escapeHtml(teacher.name)}</td>
<td>${escapeHtml(teacher.phone) || "-"}</td>
<td>${studentCountForTeacher}</td>
<td>${money(expected)}</td>
<td>${money(received)}</td>
<td>${balanceBadge(balance)}</td>
<td class="dashboard-actions">
<button class="outline-btn view-dashboard" data-id="${id}">View</button>
<button class="outline-btn copy-link" data-id="${id}">Copy Link</button>
</td>
<td>
<button class="primary-btn editTeacher" data-id="${id}">Edit</button>
<button class="danger-btn deleteTeacher" data-id="${id}">Delete</button>
</td>
</tr>
`;
    });

    if (count === 0) {
        teacherTable.innerHTML = `<tr><td colspan="8" class="empty">No teachers found</td></tr>`;
    } else if (visibleCount === 0) {
        teacherTable.innerHTML = `<tr><td colspan="8" class="empty">No teachers match your search</td></tr>`;
    }

    teacherCount.textContent = count;

    attachViewDashboardEvents();
    attachCopyEvents();
    attachTeacherRowEvents();
}

//==================================================
// COPY DASHBOARD LINK (via modal)
//==================================================

function attachViewDashboardEvents() {
    document.querySelectorAll(".view-dashboard").forEach((button) => {
        button.onclick = () => {
            const teacher = teachers[button.dataset.id];
            if (!teacher) return;

            const currentPath = window.location.pathname;
            const folderPath = currentPath.substring(0, currentPath.lastIndexOf("/") + 1);

            const url =
                window.location.origin +
                folderPath +
                "teacher.html" +
                "?id=" +
                teacher.dashboardKey;

            document.getElementById("teacherViewTitle").textContent = teacher.name + " — Dashboard";
            document.getElementById("openTeacherViewTab").href = url;
            document.getElementById("teacherViewFrame").src = url;

            teacherViewModal.classList.add("active");
        };
    });
}

function attachCopyEvents() {
    document.querySelectorAll(".copy-link").forEach((button) => {
        button.onclick = () => {
            const teacher = teachers[button.dataset.id];
            if (!teacher) return;

            const currentPath = window.location.pathname;
            const folderPath = currentPath.substring(0, currentPath.lastIndexOf("/") + 1);

            const url =
                window.location.origin +
                folderPath +
                "teacher.html" +
                "?id=" +
                teacher.dashboardKey;

            const linkInput = document.getElementById("dashboardLink");
            linkInput.value = url;

            dashboardModal.classList.add("active");
        };
    });
}

document.getElementById("copyDashboardLink").onclick = () => {
    const linkInput = document.getElementById("dashboardLink");
    linkInput.select();
    navigator.clipboard.writeText(linkInput.value);
    toast("Dashboard link copied");
};

//==================================================
// TEACHER ROW EVENTS (edit / delete)
//==================================================

function attachTeacherRowEvents() {
    document.querySelectorAll(".editTeacher").forEach((button) => {
        button.onclick = () => {
            openTeacherModal(button.dataset.id);
        };
    });

    document.querySelectorAll(".deleteTeacher").forEach((button) => {
        button.onclick = () => {
            deletePath = "lessonPayment/teachers/" + button.dataset.id;
            deleteType = "teacher";
            document.getElementById("deleteModalText").textContent =
                "Are you sure you want to delete this teacher record?";
            deleteModal.classList.add("active");
        };
    });
}

//==================================================
// ADD / UPDATE STUDENT
//==================================================

document.getElementById("saveStudent").onclick = () => {
    const name = document.getElementById("studentName").value.trim();
    const program = document.getElementById("studentProgram").value;
    const startDate = document.getElementById("startDate").value;
    const stopDate = document.getElementById("stopDate").value;
    const amountPaid = Number(document.getElementById("amountPaid").value);
    const teacherId = teacherSelect.value;

    // New registration fields
    const emailInput = document.getElementById("studentEmail");
    const addressInput = document.getElementById("studentAddress");
    const sexSelect = document.getElementById("studentSex");
    const durationInput = document.getElementById("studentDuration");
    // Description is a free-text note about the student — entirely
    // independent of the payment/amount fields, just saved alongside them.
    const descriptionInput = document.getElementById("studentDescription");

    const email = emailInput ? emailInput.value.trim() : "";
    const address = addressInput ? addressInput.value.trim() : "";
    const sex = sexSelect ? sexSelect.value : "";
    const durationMonths = durationInput ? Number(durationInput.value) : 0;
    const description = descriptionInput ? descriptionInput.value.trim() : "";

    if (name === "" || program === "" || teacherId === "" || !amountPaid || amountPaid <= 0) {
        toast("Complete all required fields");
        return;
    }

    if (sexSelect && sex === "") {
        toast("Select the student's sex");
        return;
    }

    if (durationInput && (!durationMonths || durationMonths <= 0)) {
        toast("Enter a valid duration in months");
        return;
    }

    const studentData = {
        name,
        program,
        startDate,
        stopDate,
        amountPaid,
        teacherId,
        email,
        address,
        sex,
        durationMonths,
        description
    };

    if (editingStudentId) {
        update(ref(db, "lessonPayment/students/" + editingStudentId), studentData);
        toast("Student updated successfully");
    } else {
        const studentId = push(studentsRef).key;
        set(ref(db, "lessonPayment/students/" + studentId), {
            ...studentData,
            isDeleted: false,
            createdAt: Date.now()
        });
        toast("Student added successfully");
    }

    closeStudentModal();
};

//==================================================
// LOAD STUDENTS
//==================================================

onValue(studentsRef, (snapshot) => {
    students = snapshot.val() || {};
    renderTeachers();
    renderStudents();
    calculateTotals();
});

//==================================================
// RENDER STUDENTS (search filter + pagination)
//==================================================

function renderStudents() {
    const filter = (studentSearch.value || "").trim().toLowerCase();

    // Only active (non-deleted) students appear in the list, but deleted
    // students are NOT removed from the `students` object itself, so their
    // amounts still count toward teacher totals elsewhere.
    const activeIds = Object.keys(students).filter((id) => !students[id].isDeleted);

    const filteredIds = activeIds.filter((id) => {
        if (!filter) return true;
        return (students[id].name || "").toLowerCase().includes(filter);
    });

    const visibleIds = studentsExpanded ? filteredIds : filteredIds.slice(0, STUDENT_PAGE_SIZE);

    studentTable.innerHTML = "";

    visibleIds.forEach((studentId) => {
        const student = students[studentId];
        const teacherNameForRow = teachers[student.teacherId]?.name || "Unknown";
        const teacherShare = Number(student.amountPaid || 0) / 3;
        const durationLabel = student.durationMonths
            ? student.durationMonths + " mo"
            : "-";

        studentTable.innerHTML += `
<tr>
<td>${escapeHtml(student.name)}</td>
<td>${escapeHtml(student.sex) || "-"}</td>
<td>${escapeHtml(student.email) || "-"}</td>
<td>${escapeHtml(student.address) || "-"}</td>
<td>${escapeHtml(teacherNameForRow)}</td>
<td><span class="program-tag">${escapeHtml(student.program) || "-"}</span></td>
<td>${student.startDate || "-"}</td>
<td>${student.stopDate || "-"}</td>
<td>${durationLabel}</td>
<td>${money(student.amountPaid)}</td>
<td>${escapeHtml(student.description) || "-"}</td>
<td>${money(teacherShare)}</td>
<td><a href="#" class="receipt-link printReceipt" data-id="${studentId}">Print Receipt</a></td>
<td>
<button class="primary-btn editStudent" data-id="${studentId}">Edit</button>
<button class="danger-btn deleteStudent" data-id="${studentId}">Delete</button>
</td>
</tr>
`;
    });

    if (activeIds.length === 0) {
        studentTable.innerHTML = `<tr><td colspan="14" class="empty">No students available</td></tr>`;
    } else if (filteredIds.length === 0) {
        studentTable.innerHTML = `<tr><td colspan="14" class="empty">No students match your search</td></tr>`;
    }

    studentCount.textContent = activeIds.length;

    renderStudentTableFooter(filteredIds.length);
    attachStudentRowEvents();
}

function renderStudentTableFooter(filteredCount) {
    const footer = document.getElementById("studentTableFooter");
    if (!footer) return;

    if (filteredCount <= STUDENT_PAGE_SIZE) {
        footer.innerHTML = "";
        return;
    }

    const remaining = filteredCount - STUDENT_PAGE_SIZE;
    footer.innerHTML = studentsExpanded
        ? `<button class="outline-btn small-btn" id="toggleStudentsBtn">Show Less</button>`
        : `<button class="outline-btn small-btn" id="toggleStudentsBtn">Show ${remaining} More</button>`;

    document.getElementById("toggleStudentsBtn").onclick = () => {
        studentsExpanded = !studentsExpanded;
        renderStudents();
    };
}

function attachStudentRowEvents() {
    document.querySelectorAll(".editStudent").forEach((button) => {
        button.onclick = () => {
            openStudentModal(button.dataset.id);
        };
    });

    document.querySelectorAll(".deleteStudent").forEach((button) => {
        button.onclick = () => {
            deletePath = "lessonPayment/students/" + button.dataset.id;
            deleteType = "student";
            document.getElementById("deleteModalText").textContent =
                "This removes the student from the active list. Payments already " +
                "counted toward the assigned teacher's earnings will be preserved.";
            deleteModal.classList.add("active");
        };
    });

    document.querySelectorAll(".printReceipt").forEach((link) => {
        link.onclick = (e) => {
            e.preventDefault();
            const student = students[link.dataset.id];
            if (!student) return;
            const teacherName = teachers[student.teacherId]?.name || "Unassigned";
            printStudentReceipt(student, teacherName);
        };
    });
}

//==================================================
// SEARCH LISTENERS
//==================================================

teacherSearch.addEventListener("input", renderTeachers);
studentSearch.addEventListener("input", () => {
    studentsExpanded = false;
    renderStudents();
});

//==================================================
// RECORD TEACHER PAYMENT
// New payments start as "pending" and only count toward
// totals once the teacher acknowledges them on their dashboard.
// Every new payment is always an ADDITION to the teacher's
// balance — the "deduct" option has been removed.
//==================================================

document.getElementById("savePayment").onclick = () => {
    const teacherId = paymentTeacher.value;
    const amount = Number(document.getElementById("paymentAmount").value);
    const date = document.getElementById("paymentDate").value;
    const remark = document.getElementById("paymentRemark").value.trim();

    if (teacherId === "" || !amount || amount <= 0) {
        toast("Select teacher and enter amount");
        return;
    }

    const paymentId = push(ref(db, "lessonPayment/teacherPayments/" + teacherId)).key;

    set(
        ref(db, "lessonPayment/teacherPayments/" + teacherId + "/" + paymentId),
        {
            amount,
            type: "add",
            date,
            remark,
            status: "pending",
            createdAt: Date.now()
        }
    );

    paymentModal.classList.remove("active");
    document.getElementById("paymentAmount").value = "";
    document.getElementById("paymentDate").value = "";
    document.getElementById("paymentRemark").value = "";
    paymentTeacher.selectedIndex = 0;

    toast("Payment entry recorded — awaiting teacher acknowledgement");
};

//==================================================
// LOAD PAYMENTS
//==================================================

onValue(paymentsRef, (snapshot) => {
    payments = snapshot.val() || {};
    renderTeachers();
    renderPayments();
    calculateTotals();
});

// Sums only ACKNOWLEDGED payments for one teacher.
// Legacy records saved before this feature existed have no `status` or
// `type` field — treat those as already-acknowledged additions so
// historical totals don't change. Any old "deduct" records still on
// file continue to subtract, for accurate historical accounting, but
// no new deduct entries can be created going forward.
function acknowledgedReceivedForTeacher(teacherId) {
    let received = 0;
    const teacherPayments = payments[teacherId] || {};

    Object.values(teacherPayments).forEach((payment) => {
        const status = payment.status || "acknowledged";
        if (status !== "acknowledged") return;

        const type = payment.type || "add";
        const amt = Number(payment.amount || 0);
        received += type === "deduct" ? -amt : amt;
    });

    return received;
}

function renderPayments() {
    paymentTable.innerHTML = "";
    let hasPayment = false;

    Object.keys(payments).forEach((teacherId) => {
        Object.keys(payments[teacherId]).forEach((paymentId) => {
            hasPayment = true;
            const payment = payments[teacherId][paymentId];
            const status = payment.status || "acknowledged";
            const type = payment.type || "add";
            const sign = type === "deduct" ? "−" : "+";
            const badgeCls = type === "deduct" ? "badge-negative" : "badge-positive";

            paymentTable.innerHTML += `
<tr>
<td>${escapeHtml(teachers[teacherId]?.name) || "-"}</td>
<td><span class="balance-badge ${badgeCls}">${sign}${money(payment.amount)}</span></td>
<td>${payment.date || "-"}</td>
<td>${escapeHtml(payment.remark) || "-"}</td>
<td><span class="status-badge status-${status}">${status === "acknowledged" ? "Acknowledged" : "Pending"}</span></td>
</tr>
`;
        });
    });

    if (!hasPayment) {
        paymentTable.innerHTML = `<tr><td colspan="5" class="empty">No payment history available</td></tr>`;
    }
}

//==================================================
// DASHBOARD TOTALS
//==================================================

function calculateTotals() {
    let expected = 0;
    let received = 0;

    // Expected includes every student ever created (deleted or not) so a
    // student's removal never retroactively shrinks totals already
    // reflected in acknowledged teacher payments.
    Object.values(students).forEach((student) => {
        expected += Number(student.amountPaid || 0) / 3;
    });

    Object.keys(payments).forEach((teacherId) => {
        received += acknowledgedReceivedForTeacher(teacherId);
    });

    expectedTotal.textContent = money(expected);
    paidTotal.textContent = money(received);
    balanceTotal.textContent = money(expected - received);

    const balanceCard = balanceTotal.closest(".summary-card");
    if (balanceCard) {
        balanceCard.classList.remove("card-positive", "card-negative", "card-neutral");
        const diff = expected - received;
        balanceCard.classList.add(diff > 0 ? "card-negative" : diff < 0 ? "card-positive" : "card-neutral");
    }
}

//==================================================
// DELETE CONFIRMATION MODAL
// Students are soft-deleted (flagged, not removed) so their
// historical amounts keep counting toward teacher earnings.
// Teachers are still fully removed, as before.
//==================================================

const confirmDelete = document.getElementById("confirmDelete");
const cancelDelete = document.getElementById("cancelDelete");

cancelDelete.onclick = () => {
    deleteModal.classList.remove("active");
    deletePath = "";
    deleteType = "";
};

confirmDelete.onclick = () => {
    if (deletePath === "") return;

    if (deleteType === "student") {
        update(ref(db, deletePath), {
            isDeleted: true,
            deletedAt: Date.now()
        });
        toast("Student removed from active list");
    } else {
        remove(ref(db, deletePath));
        toast("Record deleted successfully");
    }

    deleteModal.classList.remove("active");
    deletePath = "";
    deleteType = "";
};

// Close modals when clicking outside the box
[teacherModal, studentModal, paymentModal, dashboardModal, teacherViewModal, deleteModal].forEach((modal) => {
    modal.addEventListener("click", (e) => {
        if (e.target === modal) {
            modal.classList.remove("active");
            if (modal === deleteModal) {
                deletePath = "";
                deleteType = "";
            }
            if (modal === teacherModal) editingTeacherId = null;
            if (modal === studentModal) editingStudentId = null;
            if (modal === teacherViewModal) document.getElementById("teacherViewFrame").src = "about:blank";
        }
    });
});

//==================================================
// FINISH LOADING
//==================================================

window.addEventListener("load", () => {
    const loading = document.getElementById("loadingScreen");
    if (loading) {
        loading.style.display = "none";
    }
});