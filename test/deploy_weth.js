const { ethers } = require("hardhat");
const { expect } = require("chai");

describe("FlashSwap", function () {
    let deployer, alice, nonMemory, usdt, weth, usdc, usdcAddress, usdtAddress, wethAddress, routerAddress, factoryAddress, uniswapV2Factory, router
    let ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

    beforeEach(async function () {
        const factory = await ethers.getContractFactory("UniswapV2Pair");
        const bytecode = factory.bytecode;
        const initCodeHash = hre.ethers.keccak256(bytecode);
        // 需要将打印的 initCodeHash 值替换到 /contracts/UniswapV2/UniswapV2Router.sol中pairFor的hex'ee266170ab460403d8247b1e9948ccf06c1a978fbe949ae6dadbac4d32778fd5'
        // console.log("UniswapV2Pair Init Code Hash:", initCodeHash);

        // 从 ethers 提供的 signers 中获取签名者。
        [deployer, alice, nonMemory] = await ethers.getSigners();

        // =========================== 部署TOKEN ===========================
        weth = await (await ethers.getContractFactory("WETH")).deploy()
        usdt = await (await ethers.getContractFactory("USDT")).deploy()
        usdc = await (await ethers.getContractFactory("USDC")).deploy()

        usdcAddress = await usdc.getAddress();
        usdtAddress = await usdt.getAddress();
        wethAddress = await weth.getAddress();

        // =========================== 创建交易对 ===========================
        uniswapV2Factory = await (await ethers.getContractFactory("UniswapV2Factory")).deploy(ZERO_ADDRESS)
        factoryAddress = await uniswapV2Factory.getAddress()
        await uniswapV2Factory.createPair(wethAddress, usdcAddress);
        await uniswapV2Factory.createPair(wethAddress, usdtAddress);
        await uniswapV2Factory.createPair(usdcAddress, usdtAddress);

        // =========================== 部署 Router ===========================
        router = await (await ethers.getContractFactory("UniswapV2Router02")).deploy(factoryAddress, wethAddress);
        routerAddress = await router.getAddress();

        // =========================== 铸币 ===========================
        await usdc.mint(deployer.address, ethers.parseEther("1000"));
        await usdt.mint(deployer.address, ethers.parseEther("1000"));
        await weth.mint(deployer.address, ethers.parseEther("1000"));

        // =========================== 授权操作 ===========================
        // 授权给Router合约，router合约在addLiquidity的时候会将LP的代币转入池中
        await usdc.approve(routerAddress, ethers.parseEther("1000"));
        await usdt.approve(routerAddress, ethers.parseEther("1000"));
        await weth.approve(routerAddress, ethers.parseEther("1000"));


        // =========================== 添加流动性 ===========================
        // 设置交易超时时间
        const deadline = Math.floor(Date.now() / 1000) + 10 * 60; // 当前时间加10分钟作为交易的最后期限

        await router.addLiquidity(
            usdcAddress,
            usdtAddress,
            ethers.parseEther("1"), // 添加的USDC 数量
            ethers.parseEther("1"), // 添加的USDT 数量
            0,
            0,
            deployer.address,
            deadline
        );

        await router.addLiquidity(
            wethAddress,
            usdtAddress,
            ethers.parseEther("1"),
            ethers.parseEther("100"),
            0,
            0,
            deployer.address,
            deadline
        );

        await router.addLiquidity(
            wethAddress,
            usdcAddress,
            ethers.parseEther("1"),
            ethers.parseEther("100"),
            0,
            0,
            deployer.address,
            deadline
        );

        // =========================== 校验流动池中代币的个数是不是添加进去的数量 ===========================

        {
            const weth_usdt_pair = await ethers.getContractAt("UniswapV2Pair", await uniswapV2Factory.getPair(wethAddress, usdtAddress))
            const [reserve0, reserve1] = await weth_usdt_pair.getReserves()
            expect(reserve0 | reserve1).to.equal(ethers.parseEther("1") | ethers.parseEther("100"))
            // console.log("weth相对于usdt的价格:", reserve1 / reserve0, "USDT")
        }

        {
            const weth_usdc_pair = await ethers.getContractAt("UniswapV2Pair", await uniswapV2Factory.getPair(wethAddress, usdcAddress))
            const [reserve0, reserve1] = await weth_usdc_pair.getReserves()
            expect(reserve0 | reserve1).to.equal(ethers.parseEther("1") | ethers.parseEther("100"))
            // console.log("weth相对于usdc的价格:", reserve1 / reserve0, "USDC")
        }

        {
            const usdc_usdt_pair = await ethers.getContractAt("UniswapV2Pair", await uniswapV2Factory.getPair(usdcAddress, usdtAddress))
            const [reserve0, reserve1] = await usdc_usdt_pair.getReserves()
            expect(reserve0 | reserve1).to.equal(ethers.parseEther("1") | ethers.parseEther("1"))
            // console.log("usdc相对于usdt的价格:", reserve1 / reserve0, "USDT")
        }
    })

    context("FlashSwap contract test", async function () {
        it("when output = reverse1, should revert", async function () {
            await usdc.mint(alice.address, ethers.parseEther("1000"));
            await usdc.connect(alice).approve(routerAddress, ethers.parseEther("1000"));

            await expect(router.connect(alice).getAmountIn(
                ethers.parseEther("1"),
                ethers.parseEther("1"),
                ethers.parseEther("1"))).to.be.revertedWithoutReason()
        })

        it("When want getout less than true getout, should revert", async function () {
            await usdc.mint(alice.address, ethers.parseEther("1000"));
            await usdc.connect(alice).approve(routerAddress, ethers.parseEther("1000"));

            const deadline = Math.floor(Date.now() / 1000) + 60
            const path0 = [usdcAddress, usdtAddress]; // 交易路径 USDC -> USDT
            await expect(router.connect(alice).swapExactTokensForTokens(ethers.parseEther("1"), ethers.parseEther("0.5"), path0, alice, deadline)).to.be.revertedWith("UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT")
        })

        it("FlashSwap", async function () {
            await usdc.mint(alice.address, ethers.parseEther("1000"));
            await usdc.connect(alice).approve(routerAddress, ethers.parseEther("1000"));

            const deadline = Math.floor(Date.now() / 1000) + 60
            const path0 = [usdcAddress, usdtAddress]; // 交易路径 USDC -> USDT
            await expect(router.connect(alice).getAmountIn(
                ethers.parseEther("1"),
                ethers.parseEther("1"),
                ethers.parseEther("1"))).to.be.revertedWithoutReason()

            await router.connect(alice).swapExactTokensForTokens(ethers.parseEther("1"), 0, path0, alice, deadline);
            const alice_balnce = await usdt.balanceOf(alice.address)
            console.log(`alice use ${ethers.parseEther("1")} USDC swap to ${alice_balnce} USDT price is ${Number(alice_balnce) / Number(ethers.parseEther("1"))}`); // 打印兑换完成的消息
            console.log(`alice use ${ethers.parseEther("1")} USDC swap to ${alice_balnce} USDT price is ${Number(await usdt.balanceOf(alice.address)) / Number(ethers.parseEther("1"))}`); // 打印兑换完成的消息

            const flashSwap = await (await ethers.getContractFactory("FlashSwap", nonMemory)).deploy(uniswapV2Factory.target, routerAddress)
            const exampleComputeLiquidityValue = await (await ethers.getContractFactory("ExampleComputeLiquidityValue")).deploy(uniswapV2Factory.target)
            const usdc_usdt_pair = await ethers.getContractAt("UniswapV2Pair", await uniswapV2Factory.getPair(usdcAddress, usdtAddress))
            const [reserve0, reserve1] = await usdc_usdt_pair.getReserves()
            const [aToB, amountUSDTIn] = await exampleComputeLiquidityValue.computeProfitMaximizingTrade(1, 1, reserve0, reserve1)
            // 因为上面使用usdt->usdc，所以现在肯定是usdc的价格更高，所以是使用B买A，即aToB为false
            expect(aToB).to.false
            // [WETH -> USDC -> USDT -> WETH ]
            await flashSwap.connect(nonMemory).attack([wethAddress, usdtAddress, usdcAddress, wethAddress], amountUSDTIn)
            console.log(`user nonMemory through FlasSwap get ${await weth.balanceOf(nonMemory.address)} Wei`)
        })
    })
})