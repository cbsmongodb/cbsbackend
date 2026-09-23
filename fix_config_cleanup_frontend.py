import sys
from pathlib import Path

TEXT_PATCHES = {
    "src/components/RolePermissions/RolePermissions.jsx": [
        (
            "{ label: 'დაგეგმვა და გაყიდვები', keys: ['plannings', 'sales', 'budgets', 'budget_requests'] },",
            "{ label: 'დაგეგმვა და გაყიდვები', keys: ['plannings', 'plan_config', 'sales', 'budgets', 'budget_requests'] },",
        ),
    ],
    "src/messages/ka.json": [
        (
            '      "plannings": "ვიზიტების დაგეგმვა",\n      "sales": "გაყიდვების შეყვანა",',
            '      "plannings": "ვიზიტების დაგეგმვა",\n      "plan_config": "დაგეგმვის პარამეტრები",\n      "sales": "გაყიდვების შეყვანა",',
        ),
    ],
    "src/messages/en.json": [
        (
            '      "plannings": "Visit Planning",\n      "sales": "Sales Entry",',
            '      "plannings": "Visit Planning",\n      "plan_config": "Planning Settings",\n      "sales": "Sales Entry",',
        ),
    ],
    "src/messages/ru.json": [
        (
            '      "plannings": "Планирование визитов",\n      "sales": "Ввод продаж",',
            '      "plannings": "Планирование визитов",\n      "plan_config": "Настройки планирования",\n      "sales": "Ввод продаж",',
        ),
    ],
}


def patch_file(rel_path, patches):
    path = Path(rel_path)
    if not path.exists():
        print(f"ERROR: {path} not found.")
        return False

    content = path.read_text(encoding="utf-8")
    changed_any = False

    for old, new in patches:
        if old in content:
            if content.count(old) > 1:
                print(f"ERROR in {path}: expected block found more than once — refusing to guess.")
                return False
            content = content.replace(old, new)
            changed_any = True

    if changed_any:
        path.write_text(content, encoding="utf-8")
        print(f"Patched {path}.")
    else:
        print(f"{path}: already patched, nothing to do.")
    return True


def main():
    if not Path("src/components/RolePermissions/RolePermissions.jsx").exists():
        print("ERROR: run this from the frontend repo root, e.g.:\n"
              "  cd ~/Documents/cbs-frontend/website && python3 fix_config_cleanup_frontend.py")
        sys.exit(1)

    ok = True
    for rel_path, patches in TEXT_PATCHES.items():
        ok &= patch_file(rel_path, patches)

    if not ok:
        sys.exit(1)

    import json
    for rel_path in ["src/messages/ka.json", "src/messages/en.json", "src/messages/ru.json"]:
        try:
            json.loads(Path(rel_path).read_text(encoding="utf-8"))
            print(f"{rel_path}: valid JSON.")
        except json.JSONDecodeError as e:
            print(f"ERROR: {rel_path} is no longer valid JSON: {e}")
            sys.exit(1)

    print("\nNext:")
    print("  git --no-pager status")
    print("  git --no-pager diff")


if __name__ == "__main__":
    main()
