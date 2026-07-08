"""
Antigravity Dashboard - Full E2E Test Suite
Uses Playwright to test all 6 views and APIs on localhost:4000
"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from playwright.sync_api import sync_playwright, expect
import json, time

RESULTS = []

def log(status, test_name, detail=""):
    icon = "PASS" if status == "PASS" else "FAIL"
    print(f"[{icon}] {test_name}: {detail}", flush=True)
    RESULTS.append({"status": status, "test": test_name, "detail": detail})

def run_tests():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # ── 1. Page Load ──────────────────────────────────────────────
        try:
            page.goto("http://localhost:4000", timeout=15000)
            page.wait_for_load_state("domcontentloaded")
            page.wait_for_timeout(2000)  # Let JS init run
            log("PASS", "Page Load", "Dashboard loaded successfully")
        except Exception as e:
            log("FAIL", "Page Load", str(e))
            browser.close(); return

        # ── 2. Sidebar Navigation ─────────────────────────────────────
        nav_items = page.locator(".nav-item").all()
        log("PASS" if len(nav_items) >= 6 else "FAIL",
            "Sidebar Nav Items", f"Found {len(nav_items)} nav items (expected ≥6)")

        # ── 3. Header Metrics visible ─────────────────────────────────
        try:
            cpu = page.locator("#cpu-metric").inner_text(timeout=5000)
            ram = page.locator("#ram-metric").inner_text(timeout=5000)
            log("PASS" if cpu and ram else "FAIL", "Header Metrics", f"CPU={cpu}, RAM={ram}")
        except Exception as e:
            log("FAIL", "Header Metrics", str(e))

        # ── 4. Plugin Manager View ────────────────────────────────────
        try:
            page.locator(".nav-item[data-target='plugins']").click()
            page.wait_for_timeout(1000)
            cards = page.locator("#plugin-container .card").all()
            log("PASS" if len(cards) > 0 else "FAIL",
                "Plugin Manager Cards", f"Found {len(cards)} plugin cards")
        except Exception as e:
            log("FAIL", "Plugin Manager Cards", str(e))

        # ── 5. Plugin Toggle ──────────────────────────────────────────
        try:
            toggle = page.locator(".toggle-wrapper").first
            toggle.click()
            page.wait_for_timeout(500)
            log("PASS", "Plugin Toggle", "Toggle clicked without error")
        except Exception as e:
            log("FAIL", "Plugin Toggle", str(e))

        # ── 6. Skills & Agents View ───────────────────────────────────
        try:
            page.locator(".nav-item[data-target='skills']").click()
            page.wait_for_timeout(1500)
            skills = page.locator("#skills-container .card").all()
            log("PASS" if len(skills) > 0 else "FAIL",
                "Skills View", f"Found {len(skills)} skill cards")
        except Exception as e:
            log("FAIL", "Skills View", str(e))

        # ── 7. Task Scheduler View ────────────────────────────────────
        try:
            page.locator(".nav-item[data-target='tasks']").click()
            page.wait_for_timeout(500)
            name_input = page.locator("#task-name")
            cmd_input  = page.locator("#task-cmd")
            sched_input= page.locator("#task-schedule")
            log("PASS" if name_input.is_visible() else "FAIL",
                "Task Scheduler Form", "Form inputs visible")
        except Exception as e:
            log("FAIL", "Task Scheduler Form", str(e))

        # ── 8. Task Create ────────────────────────────────────────────
        try:
            page.locator("#task-name").fill("Test Task")
            page.locator("#task-cmd").fill("echo hello")
            page.locator("#task-schedule").fill("Every 1 Hour")
            page.locator(".btn").filter(has_text="Create Task").click()
            page.wait_for_timeout(1000)
            tasks = page.locator("#tasks-container .list-item").all()
            log("PASS" if len(tasks) > 0 else "FAIL",
                "Task Create", f"Found {len(tasks)} task(s) after creation")
        except Exception as e:
            log("FAIL", "Task Create", str(e))

        # ── 9. Task Delete ────────────────────────────────────────────
        try:
            delete_btn = page.locator("#tasks-container .btn-danger").first
            if delete_btn.is_visible():
                delete_btn.click()
                page.wait_for_timeout(1000)
                log("PASS", "Task Delete", "Delete button clicked successfully")
            else:
                log("FAIL", "Task Delete", "No delete button visible")
        except Exception as e:
            log("FAIL", "Task Delete", str(e))

        # ── 10. Git Source Control View ───────────────────────────────
        try:
            page.locator(".nav-item[data-target='git']").click()
            page.wait_for_timeout(500)
            git_path = page.locator("#git-path")
            git_msg  = page.locator("#git-msg")
            log("PASS" if git_path.is_visible() and git_msg.is_visible() else "FAIL",
                "Git View Form", "Git form inputs visible")
        except Exception as e:
            log("FAIL", "Git View Form", str(e))

        # ── 11. Git Status Command ────────────────────────────────────
        try:
            page.locator(".btn").filter(has_text="Status").click()
            page.wait_for_timeout(3000)
            terminal = page.locator("#git-terminal").inner_text()
            has_output = len(terminal.strip()) > 20
            log("PASS" if has_output else "FAIL",
                "Git Status Command", f"Terminal output: {terminal[:80]}...")
        except Exception as e:
            log("FAIL", "Git Status Command", str(e))

        # ── 12. Real-time Logs View ───────────────────────────────────
        try:
            page.locator(".nav-item[data-target='logs']").click()
            page.wait_for_timeout(6000)  # Wait for SSE heartbeat (5s)
            log_lines = page.locator("#log-container .log-line").all()
            log("PASS" if len(log_lines) >= 1 else "FAIL",
                "Log Stream SSE", f"Got {len(log_lines)} log lines via SSE")
        except Exception as e:
            log("FAIL", "Log Stream SSE", str(e))

        # ── 13. Session Analytics View ────────────────────────────────
        try:
            page.locator(".nav-item[data-target='session-analytics']").click()
            page.wait_for_timeout(1500)
            stats = page.locator("#sa-stats .card").all()
            log("PASS" if len(stats) >= 2 else "FAIL",
                "Session Analytics", f"Found {len(stats)} stat cards (expected >= 2)")
        except Exception as e:
            log("FAIL", "Session Analytics", str(e))

        # ── 14. File Watcher View ─────────────────────────────────────
        try:
            page.locator(".nav-item[data-target='filewatcher']").click()
            page.wait_for_timeout(500)
            watch_btn = page.locator(".btn").filter(has_text="Start Watching")
            log("PASS" if watch_btn.is_visible() else "FAIL",
                "File Watcher View", "Start Watching button visible")
        except Exception as e:
            log("FAIL", "File Watcher View", str(e))

        # ── 15. Backup & Restore View ─────────────────────────────────
        try:
            page.locator(".nav-item[data-target='backup']").click()
            page.wait_for_timeout(500)
            backup_btn = page.locator("#backup-btn")
            log("PASS" if backup_btn.is_visible() else "FAIL",
                "Backup View Form", "Create Backup button visible")
        except Exception as e:
            log("FAIL", "Backup View Form", str(e))

        # ── 16. Global Rules View ─────────────────────────────────────
        try:
            page.locator(".nav-item[data-target='global-rules']").click()
            page.wait_for_timeout(500)
            btn = page.locator(".btn").filter(has_text="+ New Rule")
            log("PASS" if btn.is_visible() else "FAIL",
                "Global Rules View", "+ New Rule button visible")
        except Exception as e:
            log("FAIL", "Global Rules View", str(e))

        # ── 17. Subagents Builder View ────────────────────────────────
        try:
            page.locator(".nav-item[data-target='subagents']").click()
            page.wait_for_timeout(500)
            btn = page.locator(".btn").filter(has_text="Build Agent")
            log("PASS" if btn.is_visible() else "FAIL",
                "Subagents Builder View", "Build Agent button visible")
        except Exception as e:
            log("FAIL", "Subagents Builder View", str(e))

        # ── 18. Online Store View ─────────────────────────────────────
        try:
            page.locator(".nav-item[data-target='online-store']").click()
            page.wait_for_timeout(1000)
            cards = page.locator("#store-list .list-item").all()
            log("PASS" if len(cards) >= 1 else "FAIL",
                "Online Store View", f"Found {len(cards)} store skills")
        except Exception as e:
            log("FAIL", "Online Store View", str(e))

        # ── 19. Macros View ───────────────────────────────────────────
        try:
            page.locator(".nav-item[data-target='macros']").click()
            page.wait_for_timeout(500)
            btn = page.locator(".btn").filter(has_text="Create Macro")
            log("PASS" if btn.is_visible() else "FAIL",
                "Macros View", "Create Macro button visible")
        except Exception as e:
            log("FAIL", "Macros View", str(e))

        # ── 20. Memory Injector View ──────────────────────────────────
        try:
            page.locator(".nav-item[data-target='memory']").click()
            page.wait_for_timeout(500)
            btn = page.locator(".btn").filter(has_text="Inject Memory")
            log("PASS" if btn.is_visible() else "FAIL",
                "Memory Injector View", "Inject Memory button visible")
        except Exception as e:
            log("FAIL", "Memory Injector View", str(e))

        # ── 21. Settings / Theme View ─────────────────────────────────
        try:
            page.locator(".nav-item[data-target='settings']").click()
            page.wait_for_timeout(500)
            circles = page.locator(".theme-circle").all()
            log("PASS" if len(circles) == 4 else "FAIL",
                "Settings Theme View", f"Found {len(circles)} theme circles (expected 4)")
        except Exception as e:
            log("FAIL", "Settings Theme View", str(e))

        # ── 22. Theme Switch ──────────────────────────────────────────
        try:
            page.locator(".tc-matrix").click()
            page.wait_for_timeout(500)
            body_class = page.locator("body").get_attribute("class")
            log("PASS" if "theme-matrix" in body_class else "FAIL",
                "Theme Switch", f"Body class after click: {body_class}")
        except Exception as e:
            log("FAIL", "Theme Switch", str(e))

        browser.close()

    # ── Print Summary ──────────────────────────────────────────────────
    print("\n" + "="*60)
    total  = len(RESULTS)
    passed = sum(1 for r in RESULTS if r["status"] == "PASS")
    failed = total - passed
    print(f"TOTAL: {total}  |  ✅ PASSED: {passed}  |  ❌ FAILED: {failed}")
    print("="*60)
    if failed > 0:
        print("\n🔴 FAILING TESTS:")
        for r in RESULTS:
            if r["status"] != "PASS":
                print(f"  - {r['test']}: {r['detail']}")

if __name__ == "__main__":
    run_tests()
