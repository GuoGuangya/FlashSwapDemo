pragma solidity 0.6.6;

import "hardhat/console.sol"; // 用于调试输出
import "./UniswapV2/UniswapV2Router.sol";
import "./libraries/UniswapV2LiquidityMathLibrary.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Callee.sol";

// 定义一个执行套利操作的合约，继承了Uniswap V2的IUniswapV2Callee接口
contract FlashSwap is IUniswapV2Callee {
    using SafeMath for uint256;

    uint public debitAmount;
    address[] public paths;
    address public owner;
    address public debitPair; // 最开始借贷的交易池
    address public debitPairToken0; // 最开始借贷的交易池
    IUniswapV2Router02 public router;
    IUniswapV2Factory public factoryAddress;

    /**
     * @param _uniswapAddress: uniswap facotryV2 contract address
     * @param _router: uniswap routeV2 contract address
     */
    constructor(address _uniswapAddress, address _router) public {
        owner = msg.sender;
        factoryAddress = IUniswapV2Factory(_uniswapAddress);
        router = IUniswapV2Router02(_router);
    }

    /**
     * @param path: 按照路径闭环
     * @param amount: [path[0], path[1]] 对应的交易池中，需要借贷的path[1] token的数量
     */
    function attack(address[] calldata path, uint256 amount) external {
        require(msg.sender == owner, "not owner");
        IUniswapV2Pair pair = IUniswapV2Pair(
            factoryAddress.getPair(path[0], path[1])
        );
        require(address(pair) != address(0), "pair not exist!");

        debitAmount = amount;
        debitPairToken0 = path[0];

        for (uint i = 1; i < path.length; i++) {
            paths.push(path[i]);
        }

        uint amount0 = path[1] == pair.token0() ? amount : 0;
        uint amount1 = path[1] == pair.token0() ? 0 : amount;

        bytes memory data = abi.encodeWithSelector(this.uniswapV2Call.selector);

        debitPair = address(pair);
        pair.swap(amount0, amount1, address(this), data);
    }

    // 当执行pair.swap操作时，Uniswap会回调这个函数
    function uniswapV2Call(
        address sender,
        uint amount0,
        uint amount1,
        bytes calldata data
    ) external override {
        require(sender == address(this), "not myself called");
        uint debitBlance = IERC20(paths[0]).balanceOf(address(this));
        IERC20(paths[0]).approve(address(router), debitBlance);

        router.swapExactTokensForTokens(
            debitBlance,
            0,
            paths,
            address(this),
            block.timestamp + 60
        );

        (uint112 _reserve0, uint112 _reserve1, ) = IUniswapV2Pair(debitPair)
            .getReserves();

        uint refundAmount = 0;

        if (IUniswapV2Pair(debitPair).token0() == paths[0]) {
            refundAmount = router.getAmountIn(
                debitAmount,
                _reserve1,
                _reserve0
            );
        } else {
            refundAmount = router.getAmountIn(
                debitAmount,
                _reserve0,
                _reserve1
            );
        }

        IERC20(debitPairToken0).transfer(msg.sender, refundAmount);
        IERC20(debitPairToken0).transfer(
            owner,
            IERC20(debitPairToken0).balanceOf(address(this))
        );

        // 避免编译警告
        amount0;
        amount1;
        data;
    }
}
