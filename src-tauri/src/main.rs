// The island is all of Tute's UI, so release builds get no console window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tute_lib::run();
}
