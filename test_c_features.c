#include <stdio.h>

int fibonacci(int n)
{
    if (n <= 1)
    {
        return n;
    }

    int a = 0, b = 1, temp;
    for (int i = 2; i <= n; i++)
    {
        temp = a + b;
        a = b;
        b = temp;
    }

    return b;
}

int main()
{
    int num = 10;

    switch (num)
    {
    case 0:
        printf("Zero\n");
        break;
    case 1:
        printf("One\n");
        break;
    default:
        printf("Fibonacci of %d is %d\n", num, fibonacci(num));
        break;
    }

    return 0;
}
