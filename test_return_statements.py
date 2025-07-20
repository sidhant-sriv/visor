def test_multiple_returns():
    x = 5
    if x > 0:
        return "positive"
    elif x < 0:
        return "negative"
    else:
        return "zero"


def test_early_return():
    if True:
        return "early"

    print("this should not be reached")
    return "late"


def test_nested_return():
    for i in range(10):
        if i == 5:
            return "found five"
        elif i == 3:
            return "found three"
    return "not found"


def test_return_in_try():
    try:
        x = 1 / 0
        return "no error"
    except:
        return "error occurred"
    finally:
        print("cleanup")
