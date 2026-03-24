#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WeChat Codex Start 右键菜单卸载脚本
双击运行即可，会自动请求管理员权限
"""

import os
import sys
import ctypes
import winreg


REG_PATHS = [
    r"Directory\Background\shell\WeChatCodexStartHere",
    r"Directory\shell\WeChatCodexStartHere",
]


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


def delete_reg_tree(root, path):
    try:
        try:
            key = winreg.OpenKeyEx(root, path, 0, winreg.KEY_READ)
            subkeys = []
            i = 0
            while True:
                try:
                    subkeys.append(winreg.EnumKey(key, i))
                    i += 1
                except OSError:
                    break
            winreg.CloseKey(key)

            for subkey in subkeys:
                delete_reg_tree(root, path + "\\" + subkey)
        except FileNotFoundError:
            pass

        winreg.DeleteKey(root, path)
        return True
    except FileNotFoundError:
        return True
    except Exception as e:
        print(f"  删除失败 {path}: {e}")
        return False


def uninstall_menu():
    success_count = 0
    for reg_path in REG_PATHS:
        print(f"\n删除菜单项: HKCR\\{reg_path}")
        if delete_reg_tree(winreg.HKEY_CLASSES_ROOT, reg_path):
            print("  [OK] 成功")
            success_count += 1
        else:
            print("  [FAIL] 失败")
    return success_count


def main():
    print("=" * 72)
    print("  WeChat Codex Start 右键菜单卸载脚本")
    print("=" * 72)
    print()

    if not is_admin():
        print("需要管理员权限，正在请求提升...")
        run_as_admin()
        return

    print("[OK] 已获得管理员权限")

    success = uninstall_menu()

    print()
    print("=" * 72)
    if success > 0:
        print(f"  [OK] 卸载完成！已处理 {success} 个菜单项")
    else:
        print("  [WARN] 没有找到需要删除的菜单项")
    print("=" * 72)

    input("\n按回车键退出...")


if __name__ == "__main__":
    main()