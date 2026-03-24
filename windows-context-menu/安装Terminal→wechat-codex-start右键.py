#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WeChat Codex Start 右键菜单安装脚本

效果：
- 在文件夹空白处或文件夹上右键
- 选择“在此处打开 WeChat Codex Start”
- 自动打开 Windows Terminal
- 在当前目录执行 wechat-codex-start

说明：
- wechat-codex-start 会自动处理 bridge 复用、切目录接管、等待 endpoint、进入 panel
- 双击运行即可，会自动请求管理员权限
"""

import os
import sys
import ctypes
import subprocess
import shutil
import winreg


MENU_KEY = "WeChatCodexStartHere"
MENU_TEXT = "在此处打开 WeChat Codex Start"
CLI_COMMAND = "wechat-codex-start"


def is_admin():
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except Exception:
        return False


def run_as_admin():
    script = os.path.abspath(__file__)
    ret = ctypes.windll.shell32.ShellExecuteW(
        None, "runas", sys.executable, f'"{script}"', None, 1
    )
    if ret > 32:
        sys.exit(0)
    else:
        print(f"✗ 无法提升权限 (错误码: {ret})")
        input("\n按回车键退出...")
        sys.exit(1)


def create_reg_key(root, path):
    try:
        return winreg.CreateKeyEx(root, path, 0, winreg.KEY_WRITE)
    except Exception as e:
        print(f"  创建键失败 {path}: {e}")
        return None


def set_reg_value(key, name, value, value_type=winreg.REG_SZ):
    try:
        winreg.SetValueEx(key, name, 0, value_type, value)
        return True
    except Exception as e:
        print(f"  设置值失败 {name}: {e}")
        return False


def find_pwsh():
    candidates = [
        r"C:\Windows\System32\WindowsPowerShell\7\pwsh.exe",
        r"C:\Program Files\PowerShell\7\pwsh.exe",
        r"C:\Program Files (x86)\PowerShell\7\pwsh.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\PowerShell\pwsh.exe"),
    ]

    for path in candidates:
        if os.path.exists(path):
            return path

    try:
        result = subprocess.run(["where", "pwsh"], capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            return result.stdout.strip().splitlines()[0]
    except Exception:
        pass

    return None


def find_wt():
    candidates = [
        shutil.which("wt"),
        os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WindowsApps\wt.exe"),
        r"C:\Program Files\WindowsApps\Microsoft.WindowsTerminal_8wekyb3d8bbwe\wt.exe",
    ]

    for path in candidates:
        if path and os.path.exists(path):
            return path

    return None


def find_icon_in_folder(folder_path: str):
    if not os.path.isdir(folder_path):
        return None

    for file in os.listdir(folder_path):
        if file.lower().endswith(".ico"):
            return os.path.join(folder_path, file)

    return None


def command_exists(command_name: str) -> bool:
    return shutil.which(command_name) is not None


def build_terminal_command(wt_path: str, pwsh_path: str | None = None):
    if pwsh_path:
        command = (
            f'"{wt_path}" new-tab -d "%V" --title "WeChat Codex Start" '
            f'"{pwsh_path}" -NoExit -Command "{CLI_COMMAND}"'
        )
        icon_path = find_icon_in_folder(os.path.dirname(pwsh_path)) or wt_path
    else:
        command = f'"{wt_path}" new-tab -d "%V" --title "WeChat Codex Start" {CLI_COMMAND}'
        icon_path = wt_path

    return command, icon_path


def install_menu(wt_path: str, pwsh_path: str | None = None):
    command, icon_path = build_terminal_command(wt_path, pwsh_path)
    menu_items = [
        ("Directory\\Background\\shell\\" + MENU_KEY, MENU_TEXT),
        ("Directory\\shell\\" + MENU_KEY, MENU_TEXT),
    ]

    success_count = 0

    print(f"\n最终命令：{command}")
    print("\n[说明] 此菜单会直接调用 wechat-codex-start。")
    print("[说明] wechat-codex-start 会自动处理 bridge 启停、目录切换与 panel 连接。")

    if not command_exists(CLI_COMMAND):
        print(f"[WARN] 当前 PATH 中未找到命令：{CLI_COMMAND}")
        print("       请确认已执行 npm link 或 npm install -g .")

    for reg_path, menu_text in menu_items:
        print(f"\n添加菜单项: {menu_text}")
        print(f"  注册表路径: HKCR\\{reg_path}")

        try:
            key = create_reg_key(winreg.HKEY_CLASSES_ROOT, reg_path)
            if key is None:
                continue

            set_reg_value(key, "", menu_text)
            set_reg_value(key, "Icon", icon_path)
            winreg.CloseKey(key)

            cmd_key = create_reg_key(winreg.HKEY_CLASSES_ROOT, reg_path + r"\command")
            if cmd_key is None:
                continue

            set_reg_value(cmd_key, "", command)
            winreg.CloseKey(cmd_key)

            print("  [OK] 成功")
            success_count += 1
        except Exception as e:
            print(f"  [FAIL] 失败: {e}")

    return success_count


def main():
    print("=" * 72)
    print("  WeChat Codex Start 右键菜单安装脚本")
    print("=" * 72)
    print()

    if not is_admin():
        print("需要管理员权限，正在请求提升...")
        run_as_admin()
        return

    print("[OK] 已获得管理员权限")

    wt_path = find_wt()
    if not wt_path:
        print("\n[FAIL] 找不到 wt.exe，请先安装 Windows Terminal，或确认 wt 已加入 PATH。")
        input("\n按回车键退出...")
        sys.exit(1)

    print(f"\nwt.exe 路径: {wt_path}")

    pwsh_path = find_pwsh()
    if pwsh_path:
        print(f"pwsh.exe 路径: {pwsh_path}")
    else:
        print("[WARN] 未找到 pwsh.exe，将使用默认 shell")

    success = install_menu(wt_path, pwsh_path)

    print()
    print("=" * 72)
    if success > 0:
        print(f"  [OK] 安装完成！已添加 {success} 个菜单项")
        print("  右键后可直接启动 WeChat Codex Start。")
    else:
        print("  [FAIL] 安装失败")
    print("=" * 72)

    input("\n按回车键退出...")


if __name__ == "__main__":
    main()
