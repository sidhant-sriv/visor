fn fibonacci(n: u32) -> u32 {
    if n <= 1 {
        return n;
    }
    
    let mut a = 0;
    let mut b = 1;
    
    for _ in 2..=n {
        let temp = a + b;
        a = b;
        b = temp;
    }
    
    b
}

fn main() {
    let result = fibonacci(10);
    println!("Fibonacci(10) = {}", result);
    
    match result {
        0 => println!("Zero!"),
        1..=10 => println!("Small number"),
        _ => println!("Big number"),
    }
}
