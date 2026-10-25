import json
import os
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

def build_excel_report():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    json_path = os.path.join(base_dir, "test-results.json")
    excel_path = os.path.join(base_dir, "DocSense_Test_Cases_Report.xlsx")

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    summary = data["summary"]
    results = data["results"]

    wb = openpyxl.Workbook()
    # Remove default sheet
    wb.remove(wb.active)

    # -----------------------------------------------------------------
    # PALETTE & STYLES
    # -----------------------------------------------------------------
    header_font = Font(name="Segoe UI", size=11, bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="1F4E78", end_color="1F4E78", fill_type="solid")
    
    subhead_font = Font(name="Segoe UI", size=12, bold=True, color="1F4E78")
    title_font = Font(name="Segoe UI", size=16, bold=True, color="1F4E78")
    subtitle_font = Font(name="Segoe UI", size=10, italic=True, color="595959")
    
    data_font = Font(name="Segoe UI", size=10, color="000000")
    bold_data_font = Font(name="Segoe UI", size=10, bold=True, color="000000")
    mono_font = Font(name="Consolas", size=9.5, color="1A252C")
    
    pass_font = Font(name="Segoe UI", size=10, bold=True, color="1E6B24")
    pass_fill = PatternFill(start_color="E2F0D9", end_color="E2F0D9", fill_type="solid")
    
    fail_font = Font(name="Segoe UI", size=10, bold=True, color="C00000")
    fail_fill = PatternFill(start_color="FCE4D6", end_color="FCE4D6", fill_type="solid")
    
    module_header_fill = PatternFill(start_color="D9E1F2", end_color="D9E1F2", fill_type="solid")
    module_header_font = Font(name="Segoe UI", size=11, bold=True, color="1F4E78")

    thin_border_side = Side(border_style="thin", color="D9D9D9")
    data_border = Border(left=thin_border_side, right=thin_border_side, top=thin_border_side, bottom=thin_border_side)
    thick_bottom = Border(bottom=Side(border_style="medium", color="1F4E78"))

    align_center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    align_left = Alignment(horizontal="left", vertical="center", wrap_text=True)
    align_top_left = Alignment(horizontal="left", vertical="top", wrap_text=True)
    align_top_center = Alignment(horizontal="center", vertical="top", wrap_text=True)

    # -----------------------------------------------------------------
    # SHEET 1: EXECUTIVE SUMMARY & METRICS
    # -----------------------------------------------------------------
    ws_sum = wb.create_sheet(title="Executive Summary")
    ws_sum.views.sheetView[0].showGridLines = True

    # Title Banner
    ws_sum["B2"] = "DocSense (Offline Notebook) - Quality Assurance & Module Test Report"
    ws_sum["B2"].font = title_font
    ws_sum["B3"] = f"Automated End-to-End Test Suite Execution • Date: {summary['timestamp'][:10]} • Overall Pass Rate: {summary['passRate']}"
    ws_sum["B3"].font = subtitle_font

    # KPI Metric Cards
    kpis = [
        ("Total Test Cases", summary["total"], "2F5597", "D9E1F2"),
        ("Passed Tests", summary["passed"], "274E13", "E2F0D9"),
        ("Failed Tests", summary["failed"], "C00000", "FCE4D6"),
        ("Overall Pass Rate", summary["passRate"], "1F4E78", "FFF2CC")
    ]

    card_col_starts = [2, 4, 6, 8]
    for idx, (label, val, txt_color, bg_color) in enumerate(kpis):
        col = card_col_starts[idx]
        card_fill = PatternFill(start_color=bg_color, end_color=bg_color, fill_type="solid")
        
        # Merge 2 columns for card
        ws_sum.merge_cells(start_row=5, start_column=col, end_row=5, end_column=col+1)
        ws_sum.merge_cells(start_row=6, start_column=col, end_row=6, end_column=col+1)
        
        c_label = ws_sum.cell(row=5, column=col, value=label)
        c_label.font = Font(name="Segoe UI", size=9, bold=True, color="595959")
        c_label.alignment = align_center
        c_label.fill = card_fill
        
        c_val = ws_sum.cell(row=6, column=col, value=str(val))
        c_val.font = Font(name="Segoe UI", size=18, bold=True, color=txt_color)
        c_val.alignment = align_center
        c_val.fill = card_fill
        
        for r in range(5, 7):
            for c in range(col, col+2):
                ws_sum.cell(row=r, column=c).border = data_border

    # Module breakdown table
    ws_sum.cell(row=9, column=2, value="Module-by-Module Test Distribution & Results").font = subhead_font

    headers_mod = ["Module #", "Module Name", "Total Tests", "Passed", "Failed", "Pass Rate (%)", "Status"]
    for c_idx, h in enumerate(headers_mod, start=2):
        cell = ws_sum.cell(row=11, column=c_idx, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = align_center
        cell.border = data_border

    # Aggregate module statistics
    module_stats = {}
    for t in results:
        m = t["moduleName"]
        if m not in module_stats:
            module_stats[m] = {"total": 0, "passed": 0, "failed": 0}
        module_stats[m]["total"] += 1
        if t["status"] == "PASS":
            module_stats[m]["passed"] += 1
        else:
            module_stats[m]["failed"] += 1

    cur_row = 12
    for mod_idx, (m_name, stats) in enumerate(module_stats.items(), start=1):
        rate = f"{(stats['passed'] / stats['total']) * 100:.1f}%"
        status_text = "PASSED" if stats["failed"] == 0 else "FAILURES"

        ws_sum.cell(row=cur_row, column=2, value=f"MOD-{mod_idx:02d}").alignment = align_center
        ws_sum.cell(row=cur_row, column=3, value=m_name).alignment = align_left
        ws_sum.cell(row=cur_row, column=4, value=stats["total"]).alignment = align_center
        ws_sum.cell(row=cur_row, column=5, value=stats["passed"]).alignment = align_center
        ws_sum.cell(row=cur_row, column=6, value=stats["failed"]).alignment = align_center
        ws_sum.cell(row=cur_row, column=7, value=rate).alignment = align_center
        
        st_cell = ws_sum.cell(row=cur_row, column=8, value=status_text)
        st_cell.alignment = align_center
        if status_text == "PASSED":
            st_cell.font = pass_font
            st_cell.fill = pass_fill
        else:
            st_cell.font = fail_font
            st_cell.fill = fail_fill

        for c in range(2, 9):
            ws_sum.cell(row=cur_row, column=c).font = bold_data_font if c in [2, 7] else (pass_font if c==8 else data_font)
            ws_sum.cell(row=cur_row, column=c).border = data_border
        cur_row += 1

    # Total row
    ws_sum.cell(row=cur_row, column=2, value="TOTALS").alignment = align_center
    ws_sum.cell(row=cur_row, column=3, value="All 7 System Modules").alignment = align_left
    ws_sum.cell(row=cur_row, column=4, value=summary["total"]).alignment = align_center
    ws_sum.cell(row=cur_row, column=5, value=summary["passed"]).alignment = align_center
    ws_sum.cell(row=cur_row, column=6, value=summary["failed"]).alignment = align_center
    ws_sum.cell(row=cur_row, column=7, value=summary["passRate"]).alignment = align_center
    tot_st = ws_sum.cell(row=cur_row, column=8, value="ALL PASSED")
    tot_st.alignment = align_center
    tot_st.font = pass_font
    tot_st.fill = pass_fill

    for c in range(2, 9):
        ws_sum.cell(row=cur_row, column=c).font = bold_data_font
        ws_sum.cell(row=cur_row, column=c).fill = PatternFill(start_color="E9EDF4", end_color="E9EDF4", fill_type="solid")
        ws_sum.cell(row=cur_row, column=c).border = Border(top=Side(style="thin"), bottom=Side(style="double"))

    # Adjust widths
    sum_col_widths = {1: 4, 2: 12, 3: 38, 4: 14, 5: 14, 6: 14, 7: 16, 8: 16, 9: 6}
    for col_idx, width in sum_col_widths.items():
        ws_sum.column_dimensions[get_column_letter(col_idx)].width = width

    # -----------------------------------------------------------------
    # SHEET 2: ALL TEST CASES (DETAILED MATRIX)
    # -----------------------------------------------------------------
    ws_details = wb.create_sheet(title="All Test Cases")
    ws_details.views.sheetView[0].showGridLines = True

    # Title block on test cases sheet
    ws_details.merge_cells("A1:G1")
    top_title = ws_details["A1"]
    top_title.value = "DocSense System Test Cases & Execution Verification Matrix"
    top_title.font = Font(name="Segoe UI", size=14, bold=True, color="FFFFFF")
    top_title.fill = header_fill
    top_title.alignment = Alignment(horizontal="center", vertical="center")
    ws_details.row_dimensions[1].height = 36

    # Column Headers requested by user:
    # 1. test case id
    # 2. what is testcse (Test Case Name)
    # 3. small description of the testcase
    # 4. what is expected output
    # 5. what our system produce as output
    # (plus Module Name and Test Status)
    headers = [
        ("Test Case ID", 15),
        ("Module", 28),
        ("Test Case (What is Test Case)", 32),
        ("Description", 45),
        ("Expected Output", 48),
        ("Actual Output (System Output)", 52),
        ("Status", 12)
    ]

    ws_details.row_dimensions[2].height = 28
    for col_idx, (header_name, col_width) in enumerate(headers, start=1):
        cell = ws_details.cell(row=2, column=col_idx, value=header_name)
        cell.font = header_font
        cell.fill = PatternFill(start_color="1B365D", end_color="1B365D", fill_type="solid")
        cell.alignment = align_center
        cell.border = data_border
        ws_details.column_dimensions[get_column_letter(col_idx)].width = col_width

    # Write each test case
    row_idx = 3
    for test in results:
        tc_id = test["tcId"]
        module = test["moduleName"]
        test_name = test["testName"]
        desc = test["description"]
        expected = test["expected"]
        actual = test["actual"]
        status = test["status"]

        # Zebra striping background for data rows
        is_even = (row_idx % 2 == 0)
        row_fill = PatternFill(start_color="F9FAFB" if is_even else "FFFFFF", end_color="F9FAFB" if is_even else "FFFFFF", fill_type="solid")

        c1 = ws_details.cell(row=row_idx, column=1, value=tc_id)
        c1.alignment = align_top_center
        c1.font = bold_data_font

        c2 = ws_details.cell(row=row_idx, column=2, value=module)
        c2.alignment = align_top_left
        c2.font = data_font

        c3 = ws_details.cell(row=row_idx, column=3, value=test_name)
        c3.alignment = align_top_left
        c3.font = bold_data_font

        c4 = ws_details.cell(row=row_idx, column=4, value=desc)
        c4.alignment = align_top_left
        c4.font = data_font

        c5 = ws_details.cell(row=row_idx, column=5, value=expected)
        c5.alignment = align_top_left
        c5.font = data_font

        c6 = ws_details.cell(row=row_idx, column=6, value=actual)
        c6.alignment = align_top_left
        c6.font = mono_font

        c7 = ws_details.cell(row=row_idx, column=7, value=status)
        c7.alignment = align_top_center
        if status == "PASS":
            c7.font = pass_font
            c7.fill = pass_fill
        else:
            c7.font = fail_font
            c7.fill = fail_fill

        for col_i in range(1, 8):
            cell = ws_details.cell(row=row_idx, column=col_i)
            cell.border = data_border
            if col_i != 7:
                cell.fill = row_fill

        # Dynamic row height based on content length
        max_chars = max(len(str(desc)), len(str(expected)), len(str(actual)))
        approx_lines = max(1, (max_chars // 45) + 1)
        ws_details.row_dimensions[row_idx].height = min(120, max(25, approx_lines * 16))

        row_idx += 1

    # Freeze header rows on both sheets
    ws_details.freeze_panes = "A3"
    ws_sum.freeze_panes = "A4"

    # Enable auto filter on details sheet
    ws_details.auto_filter.ref = f"A2:G{row_idx-1}"

    wb.save(excel_path)
    print(f"Excel report successfully generated at: {excel_path}")

if __name__ == "__main__":
    build_excel_report()
