const std = @import("std");

pub export fn alloc(size: usize) ?[*]u8 {
    const buffer = std.heap.wasm_allocator.alloc(u8, size) catch return null;
    return buffer.ptr;
}

pub export fn free(pointer: [*]u8, size: usize) void {
    std.heap.wasm_allocator.free(pointer[0..size]);
}

pub export fn pick_target(rects_ptr: [*]const f32, rect_count: usize, x: f32, y: f32) i32 {
    var best_index: i32 = -1;
    var best_area = std.math.inf(f32);

    var index: usize = 0;
    while (index < rect_count) : (index += 1) {
        const base = index * 4;
        const left = rects_ptr[base];
        const top = rects_ptr[base + 1];
        const width = rects_ptr[base + 2];
        const height = rects_ptr[base + 3];

        if (width <= 0 or height <= 0) {
            continue;
        }

        if (x >= left and x <= left + width and y >= top and y <= top + height) {
            const area = width * height;
            if (area <= best_area) {
                best_area = area;
                best_index = @intCast(index);
            }
        }
    }

    return best_index;
}
