fn simple_function(x: i32) -> i32 {
    if x > 0 {
        x * 2
    } else {
        0
    }
}

fn complex_function(data: Vec<i32>) -> Result<i32, String> {
    let mut result = 0;
    
    for item in data {
        match item {
            x if x > 10 => {
                if x % 2 == 0 {
                    result += x * 2;
                } else {
                    result += x;
                }
            },
            x if x > 0 => result += 1,
            _ => return Err("Invalid data".to_string()),
        }
    }
    
    Ok(result)
}

async fn async_function() -> Result<String, Box<dyn std::error::Error>> {
    let response = fetch_data().await?;
    let processed = process_data(response).await?;
    Ok(processed)
}

fn higher_order_function() {
    let numbers = vec![1, 2, 3, 4, 5];
    let doubled: Vec<i32> = numbers
        .iter()
        .filter(|&&x| x > 2)
        .map(|&x| x * 2)
        .collect();
}
