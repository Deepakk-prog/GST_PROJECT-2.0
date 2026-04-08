// Theme Logic
function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute("data-theme");
  const newTheme = currentTheme === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", newTheme);
  localStorage.setItem("theme", newTheme);
  document.getElementById("themeToggle").innerText =
    newTheme === "dark" ? "☀️" : "🌙";
}

// Load saved theme
const savedTheme = localStorage.getItem("theme") || "light";
document.documentElement.setAttribute("data-theme", savedTheme);
window.onload = () => {
  document.getElementById("themeToggle").innerText =
    savedTheme === "dark" ? "☀️" : "🌙";
};

let currentMode = "monthly";

const STATE_CODES = {
  "andaman and nicobar islands": "35",
  "andhra pradesh": "37",
  "arunachal pradesh": "12",
  assam: "18",
  bihar: "10",
  chandigarh: "04",
  chhattisgarh: "22",
  "dadra and nagar haveli": "26",
  "daman and diu": "25",
  delhi: "07",
  goa: "30",
  gujarat: "24",
  haryana: "06",
  "himachal pradesh": "02",
  "jammu and kashmir": "01",
  jharkhand: "20",
  karnataka: "29",
  kerala: "32",
  ladakh: "38",
  lakshadweep: "31",
  "madhya pradesh": "23",
  maharashtra: "27",
  manipur: "14",
  meghalaya: "17",
  mizoram: "15",
  nagaland: "13",
  odisha: "21",
  puducherry: "34",
  punjab: "03",
  rajasthan: "08",
  sikkim: "11",
  "tamil nadu": "33",
  telangana: "36",
  tripura: "16",
  "uttar pradesh": "09",
  uttarakhand: "05",
  "west bengal": "19",
};

function switchMode(mode) {
  currentMode = mode;
  document
    .getElementById("btnMonthly")
    .classList.toggle("active", mode === "monthly");
  document
    .getElementById("btnQuarterly")
    .classList.toggle("active", mode === "quarterly");

  const desc = document.getElementById("modeDesc");
  const sInput = document.getElementById("salesInput");
  const rInput = document.getElementById("returnInput");

  if (mode === "monthly") {
    desc.innerHTML = "Processing for: <strong>Monthly Return</strong>";
    sInput.multiple = false;
    rInput.multiple = false;
  } else {
    desc.innerHTML =
      "Processing for: <strong>Quarterly Return (Select 3 Files)</strong>";
    sInput.multiple = true;
    rInput.multiple = true;
  }
}

async function readExcel(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      resolve(
        XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]),
      );
    };
    reader.readAsArrayBuffer(file);
  });
}

async function handleProcessing() {
  const statusDiv = document.getElementById("status");
  const sFiles = document.getElementById("salesInput").files;
  const rFiles = document.getElementById("returnInput").files;

  if (sFiles.length === 0 || rFiles.length === 0) {
    statusDiv.innerHTML =
      '<span class="error">Dono files select karein!</span>';
    return;
  }

  statusDiv.innerText = "Processing Data...";

  try {
    let allSales = [];
    let allReturns = [];

    for (let file of sFiles) allSales = allSales.concat(await readExcel(file));
    for (let file of rFiles)
      allReturns = allReturns.concat(await readExcel(file));

    const firstRow = allSales[0];
    const gstin = String(firstRow.gstin).toUpperCase();

    // GSTIN Validation
    const gstinRegex = /^[0-9]{2}[A-Z0-9]{13}$/;
    if (!gstinRegex.test(gstin)) throw new Error("Invalid GSTIN");

    const HOME_STATE = gstin.substring(0, 2);

    // FP Calculation
    let fp = "";
    if (currentMode === "monthly") {
      let mm = String(firstRow.month_number).padStart(2, "0");
      fp = mm + String(firstRow.financial_year).slice(-4);
    } else {
      let maxM = 0;
      allSales.forEach((r) => {
        let m = parseInt(r.month_number);
        if (m > maxM) maxM = m;
      });
      fp =
        String(maxM).padStart(2, "0") +
        String(firstRow.financial_year).slice(-4);
    }

    let summary = {};

    const process = (data, isReturn) => {
      data.forEach((row) => {
        let stateName = String(row.end_customer_state_new || "")
          .toLowerCase()
          .trim();
        let pos = STATE_CODES[stateName];

        if (!pos) {
          console.warn("Invalid state:", stateName);
          return;
        }

        let taxable = parseFloat(row.total_taxable_sale_value) || 0;
        let rate = parseFloat(row.gst_rate) || 0;

        if (!rate) return;

        let key = `${pos}_${rate}`;
        if (!summary[key]) summary[key] = { pos, rate, taxable: 0 };

        let multiplier = isReturn ? -1 : 1;
        summary[key].taxable += taxable * multiplier;
      });
    };

    process(allSales, false);
    process(allReturns, true);

    const b2cs = Object.values(summary)
      .filter((i) => i.taxable !== 0)
      .map((i) => {
        let isIntra = i.pos === HOME_STATE;
        let tax = (i.taxable * i.rate) / 100;

        if (isIntra) {
          return {
            sply_ty: "INTRA",
            pos: i.pos,
            rt: i.rate,
            typ: "OE",
            txval: Number(i.taxable.toFixed(2)),
            camt: Number((tax / 2).toFixed(2)),
            samt: Number((tax / 2).toFixed(2)),
          };
        } else {
          return {
            sply_ty: "INTER",
            pos: i.pos,
            rt: i.rate,
            typ: "OE",
            txval: Number(i.taxable.toFixed(2)),
            iamt: Number(tax.toFixed(2)),
          };
        }
      });

    const finalJson = {
      gstin,
      fp,
      version: "GST3.2.1",
      hash: "hash",
      b2cs,
    };

    const blob = new Blob([JSON.stringify(finalJson, null, 2)], {
      type: "application/json",
    });

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `GSTR1_${currentMode.toUpperCase()}_${gstin}_${fp}.json`;
    a.click();

    statusDiv.innerHTML = '<span class="success">JSON Downloaded! ✅</span>';
  } catch (err) {
    statusDiv.innerHTML = `<span class="error">Error: ${err.message}</span>`;
  }
}
