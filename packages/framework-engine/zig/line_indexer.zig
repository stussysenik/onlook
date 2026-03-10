const std = @import("std");

pub export fn alloc(size: usize) ?[*]u8 {
    const buffer = std.heap.wasm_allocator.alloc(u8, size) catch return null;
    return buffer.ptr;
}

pub export fn free(pointer: [*]u8, size: usize) void {
    std.heap.wasm_allocator.free(pointer[0..size]);
}

pub export fn count_line_starts(source_pointer: [*]const u16, source_length: usize) u32 {
    var count: u32 = 1;

    for (source_pointer[0..source_length]) |code_unit| {
        if (code_unit == '\n') {
            count += 1;
        }
    }

    return count;
}

pub export fn fill_line_starts(
    source_pointer: [*]const u16,
    source_length: usize,
    output_pointer: [*]u32,
    output_length: usize,
) u32 {
    if (output_length == 0) {
        return 0;
    }

    output_pointer[0] = 0;
    var written: usize = 1;

    var index: usize = 0;
    while (index < source_length and written < output_length) : (index += 1) {
        if (source_pointer[index] == '\n') {
            output_pointer[written] = @intCast(index + 1);
            written += 1;
        }
    }

    return @intCast(written);
}
