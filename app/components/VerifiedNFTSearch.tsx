'use client';

import { useState, useMemo, useEffect } from 'react';
import { VERIFIED_NFTS } from '../config/verifiedNFTs';
import SafeImage from './SafeImage';
import VerifiedBadge from './VerifiedBadge';
import React from 'react';

// Mapping of contract addresses to their image URLs from Reservoir Tools
const NFT_LOGOS: { [key: string]: string } = {
  '0x46c66c40711a2953d1768926e53134c7ab272cd5': 'https://img.reservoir.tools/images/v2/monad-testnet/i9YO%2F4yHXUdJsWcTqhqvf9a39%2FcEoEcwFg9osliSM37qoAKUaf49H6HUkQkKr7pqxjw4z%2B3YvLr06Xl4LWRTbnTobVwd6ZYy22hR8SSy9rbNOTw4CXClNKGhMk%2FsyxnC.mp4',
  '0x6ed438b2a8eff227e7e54b5324926941b140eea0': 'https://img.reservoir.tools/images/v2/monad-testnet/%2B6JFiKil%2F%2Fpz3ZMLrwm%2Bygy56iuC%2FZYgnmUlgCTie8wARB4gHElpDtFtJKtjr4%2FY9AD0lNtcs6OE%2FTXelKqeJC2GPCgLmp6ws6O6NB9aK%2Fs3JZErA3Cla7cGWfiqpXEVdDpmJRlXD5Fh9R6R32GXJg%3D%3D.jpg?width=512',
  '0x88bbcba96a52f310497774e7fd5ebadf0ece21fb': 'https://img.reservoir.tools/images/v2/monad-testnet/rSNTYhb5erNxjAvRIO43VgXzddRzWXfhG%2F15Qa2AQUXst%2BWKmPQ8zRLBH8ZMOW7IRO1UaQD%2F6Zne9%2FZjP8KNLSylkMlW%2Bg6TDDuYe95opcmO9HIl4ULzrDjPZDb41CNP.png?width=512',
  '0x7370a0a9e9a833bcd071b38fc25184e7afb57aff': 'https://img.reservoir.tools/images/v2/monad-testnet/O1GmUbX%2FvNODx2ebXhWa15l6RobxLnIGvx43qC2%2Bw2x9Qnvh94MOixnX8AsEgKs99YmhIxjqsfBbGK09DwbbT6a7%2ByCdcVi7wtLX0w3d%2FImDA65giPxxg2vxehheUEyX.gif?width=512',
  '0xe6b5427b174344fd5cb1e3d5550306b0055473c6': 'https://img.reservoir.tools/images/v2/monad-testnet/%2BF4uAprNqLw%2FUAbX2wIMCIbzjvo%2F02w509ovJwckv%2BrXQgCbx1aPZ8%2FfXcoWvWJMb42SAJUYtod5j6Az5PvjRCTu92TUXD1r2ZHD18JxltT5dwM3R2xtkMOTU%2Frqldif.jpg?width=512',
  '0x6fe6f1212386da0c3449012a9a6d092f61045e24': 'https://img.reservoir.tools/images/v2/monad-testnet/i9YO%2F4yHXUdJsWcTqhqvf7Qrz6rd9nl%2FCocQggRvdMkYG6pDf7b0Xf4heM8QihkcoZmbaHNh4YIY1%2Bw%2FQsfDgJbxlKFArAjjX3SuSDYHOUDfCjdPU13jBYOiHeXhyzt3.jpg?width=512',
  '0xf3ad8b549d57004e628d875d452b961affe8a611': 'https://img.reservoir.tools/images/v2/monad-testnet/i9YO%2F4yHXUdJsWcTqhqvf4OBLNt10vBh16lfOvbHMTRaqq2%2B77w5JcnVCVueRBkz60dRUQsi5IZ%2FPMMyjKN0Gls4kAxPiupUx%2FPn6T6up5RV2%2Bj1GVVNBMSVicCtLu2c.webp?width=512',
  '0x800f8cacc990dda9f4b3f1386c84983ffb65ce94': 'https://img.reservoir.tools/images/v2/monad-testnet/i9YO%2F4yHXUdJsWcTqhqvf6npjEQAnljoZ8hZfAaMMvW1aplh0T2wY3vFcFZoCe5ZDNEOLknDmupoFqhZ4GJGysVK6nqwTPTafC5aib82J6S6RMrdt7Z7qjX%2BqF0hUHWa.gif?width=512',
  '0xa980f072bc06d67faec2b03a8ada0d6c9d0da9f8': 'https://img.reservoir.tools/images/v2/monad-testnet/i9YO%2F4yHXUdJsWcTqhqvf9MyzB5ELtHte232njA%2FRlXT%2B3Zi47nnB3tjOVZqrGqVKGtlxPaSUaixV7PXKNYu6k8lTo2e6yQvi9CxYF4mdQpGTgO2VbJ7tD2Mj3T3vsii.png?width=512',
  '0x26c86f2835c114571df2b6ce9ba52296cc0fa6bb': 'https://img.reservoir.tools/images/v2/monad-testnet/O1GmUbX%2FvNODx2ebXhWa11ySkIf7ggVFPcurHphMiqEDrPc5l3hh6whHcYDLMhU%2FIlu3DuLBJ2F3sYhgyUt4YCt3QeMDH1YowfOrOi7Y0ieaDBahM1rmQo3cWwUEtvon.mp4',
  '0xb0a663cf4853e67221fee43322fda402e21debfc': 'https://img.reservoir.tools/images/v2/monad-testnet/%2F5Jbi0Ns6zow6QFNdglhEnJUv2wTT%2FWW6GnxkyLrs%2FIimEWlwLiDTwUgY0HYwfw%2BIRF5i3W1d1BDoHIVhBC6BNzsEk6m%2Bw1Aw%2B%2BW4iTPqHQSBvnJ8xHFt2fafk5RTqTJ.png?width=512',
  '0x38f3730b009ec1707f5409caf44e329cc7b4d050': 'https://img.reservoir.tools/images/v2/monad-testnet/%2BF4uAprNqLw%2FUAbX2wIMCJIMwbejN%2FoO7snHF6gtisMtduIqmLVxLJ8xGvpSY%2FV9pxAGosguWtiYiQd%2F36SCQ53GLSq5C8JlkGm5%2Fn4A5mXtlp2S6bayduVrPuM51KDJ.gif?width=512',
  '0x4bac889f20b9de43734f15379096c98f34154c50': 'https://img.reservoir.tools/images/v2/monad-testnet/i9YO%2F4yHXUdJsWcTqhqvf8WJG4OC%2BHS7ZtofUxNajYG%2FHJ3xz1uAJ67OUc86i41kkI692Ev0K632SWIIl1tyKunlk7vzpR7XYtHCl6F7phjOt%2Bo47F7G5hKl2KHMVKar.mp4',
  '0x3db6c11474893689cdb9d7cdedc251532cadf32b': 'https://img.reservoir.tools/images/v2/monad-testnet/%2BF4uAprNqLw%2FUAbX2wIMCCWwPLe3XPv78qgkQ7XEnBdqUZRHh%2Fi5mIY59dkW3e%2F0%2FizkPBBLa%2BDH4rDmyuJxy7%2BtqRjhchb7pYjsacHP796xePYCzOTnxqI4uSrGwxNn.png?width=512',
  '0xa568cabe34c8ca0d2a8671009ae0f6486a314425': 'https://img.reservoir.tools/images/v2/monad-testnet/i9YO%2F4yHXUdJsWcTqhqvf9WkBgX1tz1qMST8xxboPflqRzNvfqDUtRSv%2BCbNSqiGM%2Ffr%2BxaGPCdZ7DzbECRwfDbyE0Hd2XVLwwgq1YgTt7zdbTgIoo%2FSp5R4JLoSMBMr.jpg?width=512',
  '0xd60c64487d581d5eb2b15f221bd6d8187a9a4aef': 'https://img.reservoir.tools/images/v2/monad-testnet/%2F5Jbi0Ns6zow6QFNdglhEr8NrUz3Vhar4vzfujATXBmdaOvi7x4qf2Q7f%2BSkzbjdymTc5QEjFM1B%2FIhFcAIHEAdzKgAccKyFOb5%2FkYzwcHCPp3KVNxQVHZJCDdNpmcMQ.png?width=512',
  '0x66e40f67afd710386379a6bb24d00308f81c183f': 'https://img.reservoir.tools/images/v2/monad-testnet/i9YO%2F4yHXUdJsWcTqhqvf3xttEmHKUHy3peC1bv2cC3%2F4cZfh%2FnkRo%2FoSDSqQtv0yPeoSNV2%2FIWqH0rG0uXLc21ZwtIC08urjc%2Fct363Rr6wQnT7aK%2BNakbL59jWNM81.jpg?width=512',
  '0x6341c537a6fc563029d8e8caa87da37f227358f4': 'https://img.reservoir.tools/images/v2/monad-testnet/i9YO%2F4yHXUdJsWcTqhqvf229SrGyBpkj32h4yAwJ%2B49jt2jebUcK8swGU8eT1%2BEqOa10hu4VebpGFvzyktL0E%2BDGjtD4VYUxFE%2FBeBxd4%2FEA5sENAGovTj6TfYGOuxKi.mp4',
  '0xe7453456fe59c2e81e7a9d12ac9e6119d068356b': 'https://img.reservoir.tools/images/v2/monad-testnet/%2F2IIP7h32C3MN9okTYDl6xmptUMlwO8Nqtj9T63QqNroBc5nKDEWGULFNWxTZw99eJRiotU56RSXLpuRuzIdvGad75eX6%2BP4FokbkLjHB%2FK%2FhvZt4f6AX%2BdG1gMi9KFv.webp?width=512',
  '0xdd929fe744c34e225c3dbd83030996c65370b6c0': 'https://img.reservoir.tools/images/v2/monad-testnet/i9YO%2F4yHXUdJsWcTqhqvf9TYxAIha0h3FZrXWFkfdBxcA4eB0hGydWA0nVsuz2xhWuUDyA1UoE9Niae%2Bzbhc2ukSQVtMNEmu0Zv6F8dHODuLKlhaBw%2FTnpoaQDxT9e5d.png?width=512',
  '0xe25c57ff3eea05d0f8be9aaae3f522ddc803ca4e': 'https://img.reservoir.tools/images/v2/monad-testnet/i9YO%2F4yHXUdJsWcTqhqvf2ME9ilfqTiN3oLgxc6lg8oJPFyFYK1sI6Rx7ZlHO%2Fp1%2FOSIAsp2ceTM%2BIx1HK5Q%2BpaFxZ43SQF0SSPHGMs%2BC3J696O563J3CFkiiBCQY4Dh.png?width=512',
  '0x3a9acc3be6e9678fa5d23810488c37a3192aaf75': 'https://img.reservoir.tools/images/v2/monad-testnet/i9YO%2F4yHXUdJsWcTqhqvfylzAOg2N3k8YB%2FKp4ZnUHGKdjI7UgbXn5pkTVQw9UC10KXNOzNr1jDDSQUG6GG3XGQs07wAUQSZosF7%2FKTI03p7i7%2F%2BVcisUXE%2F6Dj%2Bstuc.png?width=512',
  '0xcab08943346761701ec9757befe79ea88dd67670': 'https://img.reservoir.tools/images/v2/monad-testnet/i9YO%2F4yHXUdJsWcTqhqvf%2B5X5v3mmKMnD5vOj6wE06%2FGl%2BVSKrufFWFBChTKZugjCGr6HRBZf5eZVe2j4ut2TrxptzmHg0XJu5J6%2BKTkh20j1XAsrdH4NSv5gxr9iHKU.png?width=512',
  '0xba838e4cca4b852e1aebd32f248967ad98c3aa45': 'https://img.reservoir.tools/images/v2/monad-testnet/i9YO%2F4yHXUdJsWcTqhqvf580abzh2cEYdyw%2Bfm9ex9AFPekadT9pB1%2Fynph09eDAaHYwR6%2BBMnQtH1vKCa4gFP%2BcL%2FEvYJZgedDyKveegI6hmIBeSYEdXObOb5UcF%2FWX.png?width=512',
  '0x5d2a7412872f9dc5371d0cb54274fdb241171b95': 'https://img.reservoir.tools/images/v2/monad-testnet/i9YO%2F4yHXUdJsWcTqhqvf8PELbYr%2FqnbVReKHn4%2FIAlB5T3kHZ1jVLL66ZY74dZYVHdt2%2BC7xt8quNNUu%2BPHMlT1OyixrRQZVZJsvWTvHskrahHf9BP%2Fx7Yzs%2BYk4Yi1.png?width=512',
  '0x813fa68dd98f1e152f956ba004eb2413fcfa7a7d': 'https://img.reservoir.tools/images/v2/monad-testnet/i9YO%2F4yHXUdJsWcTqhqvf9NA2KpiMAp72MTPaXeuIqqXkUxIkPIMAbKansSa2BijZledL6tfDneR8k6gGQdrMUcaNTvXHGGWnT7xhCZSK3VZ3jxCz8F7UFJx11PrQwgY.png?width=512',
  '0xc29b98dca561295bd18ac269d3d9ffdfcc8ad426': 'https://img.reservoir.tools/images/v2/monad-testnet/i9YO%2F4yHXUdJsWcTqhqvfw00uDWvGMCSQZ6i2AIEOr7xakvgVwpvAo2TwB3KenkhJF8I6jJyYzHyiP0vp2EG4w0PO8MiawMj9pB5a39d5EAbnuCiCew3Sncx58eUGeYk.png?width=512',
  '0xce3be27bdf0922e92bbf3c2eefbb26487946ed4c': 'https://img.reservoir.tools/images/v2/monad-testnet/i9YO%2F4yHXUdJsWcTqhqvf7eMuQ0lbK9TrPfi7A3wlF2gHtv9pSZmlHb%2FCMbEp41J%2Fm43vr4psNJFAKs61Z%2F0wrH369aEwkgXd%2FgNE2XAitpKOWJK9jQm6S2sZSkS7dca.png?width=512',
  '0xa18e1c7c6e8c663c5d835fffd70ef07b482fe884': 'https://img.reservoir.tools/images/v2/monad-testnet/i9YO%2F4yHXUdJsWcTqhqvf5cBkt4y%2FGA%2F9GeLVsXTM5y8qi4eXlxxCLW1dlqmmGpXFl0jZxBM0w0xC%2BRFOJXY8rdTsEx%2BasTUgus731BoEl0zqWLZHL5l0uiTtRQWiYkD.png?width=512',
  '0xed11a8cd63b6c6ddb9847e08bafccc7b538a3700': 'https://img.reservoir.tools/images/v2/monad-testnet/i9YO%2F4yHXUdJsWcTqhqvf3YU9ts1%2BMXWve5nxRMmAhUfTAT%2BE786WSQE%2BaEFP%2B%2B8v8zP86W59lupd%2FUdOJXtuGtDRAogFjhW1aQcIaZlabByt%2BFZy69KJ0q1fZT3FwYG.jpg?width=512',
  '0x84db60168be10fb2ae274ea84e24cb22ffe11ddd': 'https://img.reservoir.tools/images/v2/monad-testnet/%2F5Jbi0Ns6zow6QFNdglhEv%2FwIsqnboSrh8zE%2FQM7wAqL0vi5WdB5%2FX3SKaoLslaH1IZvK5sv9m04xednQM9E%2Fq9SDDwrNeBOk1M180SJA8zhmkn3MO3C%2B4KgnD1QZXc4.mp4',
  '0x7ea266cf2db3422298e28b1c73ca19475b0ad345': 'https://img.reservoir.tools/images/v2/monad-testnet/rSNTYhb5erNxjAvRIO43Vr%2BZ1LStI1VoQ4P5ib1oQfF0cfuED5GwnAPxgJIHrOq%2B2mJ2v%2FM%2FzxGnt47FKNK6P7ArSDUDr%2BvBL%2Bz6s%2FJHQ4zioi2yy%2BKr2SFHby6SqUMF.png?width=512',
  '0xff59f1e14c4f5522158a0cf029f94475ba469458': 'https://img.reservoir.tools/images/v2/monad-testnet/J%2FakncCOHOIfeMhBgr9%2FLAcyEU8%2BFktFuFTzVucW7VV%2FN%2B08uHMSxcTFLrCcVU4CJqfp23s2vj7eTqiGz8i7HPc%2Bsb4v2s8vc5b%2BWxRMf0Hp3xy6ntfPzPCNvK4%2FtrRd.gif?width=512',
  '0x49d54cd9ca8c5ecadbb346dc6b4e31549f34e405': 'https://img.reservoir.tools/images/v2/monad-testnet/O1GmUbX%2FvNODx2ebXhWa13YNaLqlU1ap4vRPu9NeHK1a0owFF3TAnFPHmWE1asq0O9SBzFBg2lv0AJyrrwIBEkXzq4U6A4o%2FD3DGncPUZ7kgAjCRKZnuzz9kCjJflapq.png?width=512',
  '0xc5c9425d733b9f769593bd2814b6301916f91271': 'https://img.reservoir.tools/images/v2/monad-testnet/O1GmUbX%2FvNODx2ebXhWa13rKYbSBvxCIcUh0wI6lowTq%2F8LtXaT1hdr3n3ilb6qxsqeJN6a%2BPxYTvSOeFPFkfZwDkEPB46Np7zG8fMRFOFdabopBc3uZT34xrUqeTqEP.png?width=512',
  '0x4fcf36ac3d46ef5c3f91b8e3714c9bfdb46d63a3': 'https://img.reservoir.tools/images/v2/monad-testnet/gHTKSzFx0LtiQ%2F9Ps%2BvNeVgBFAztuwXodw2%2BCjKTPZz652KFwF9YgjS5bGJ8IJ144h5QFfNT8vhI5nQVhIezKEC7E6XoDwFfbKVClWbWRqAdk4A30zhPXowGIQhveLpIkVV39gA6OXxS2vltx2C8kSbD04HRw9J46BeYB%2FMxOUw%3D.png?width=512',
  '0x4870e911b1986c6822a171cdf91806c3d44ce235': 'https://img.reservoir.tools/images/v2/monad-testnet/i9YO%2F4yHXUdJsWcTqhqvf0FC7FWspJf%2FkSLQs99AFPrqMcL74njtkEoKZq5GoMZABd%2BTeL2sFRlWlBJELKSdAXCxllQjcqYqi2XXAPLpTvqvHTKO1IT1%2Fyfx6DeModZv9UYuVdtsOSL9VGogmm7E3w%3D%3D.mp4',
  '0xe8f0635591190fb626f9d13c49b60626561ed145': 'https://img.reservoir.tools/images/v2/monad-testnet/xGIQsppdhx9jPELiWEASU%2FjUqyN30zbMlUWyRD8eC9mBC4Xx9S%2FMOnyJExVCFyjSd2mbq5cmkbR%2BjI1pJtmvMnm21z7MQpjYT8IxahQ%2BSQkUJ5dysyzCI84pyiMDrgxW.png?width=512',
  '0x87e1f1824c9356733a25d6bed6b9c87a3b31e107': 'https://img.reservoir.tools/images/v2/monad-testnet/i9YO%2F4yHXUdJsWcTqhqvf0aTPGa7dMbaoJpVINCUIuTbYpz%2FAM0ZI38bbmW5peeVIgH4fvhO%2Fqgc3c%2Bvqag4utIVFcylE0oHY%2Bz0sS4qeqHdHlpd2SWp0Nn%2BqMLFV2WT.png?width=512',
  '0xbb406139138401f4475ca5cf2d7152847159eb7a': 'https://img.reservoir.tools/images/v2/monad-testnet/O1GmUbX%2FvNODx2ebXhWa1%2B8K4b5wBAIdx1x3DvCT3i9659CN7vWTbObeFYe%2Bh2QfDZJE0ISpgZ82kldHXrYc2O%2FpyHo010fibes%2BOibBhcLxLKZ5Gu268JJYlXG%2BM0nN.gif?width=512',
  '0x3a1f97fcce3100711b2554402761510bc85e5291': 'https://img.reservoir.tools/images/v2/monad-testnet/i9YO%2F4yHXUdJsWcTqhqvf%2BLdI6Od35WjbT%2FP8weD%2BFrfuUD7Gt8mZrlAYss%2F47TSDnF2Z6P2RDL4uRG%2BLO4PiL8qVCrueo9GAsKhEalB6rqwftC5UFI3UbVCv8p4jR1o.png?width=512',
  '0x3a9454c1b4c84d1861bb1209a647c834d137b442': 'https://img.reservoir.tools/images/v2/monad-testnet/i9YO%2F4yHXUdJsWcTqhqvf2m2fsg6SgediRt3NjLob9r1O3j2cR3a3Nbq42gaWeIws2ovhfbd1wWu5wdx8LQJWWpWbJyLdzBZOQmDu5R2Sir%2FpkPbXDpa8AY2rKjz1ju5.png?width=512',
  '0x78ed9a576519024357ab06d9834266a04c9634b7': 'https://img.reservoir.tools/images/v2/monad-testnet/i9YO%2F4yHXUdJsWcTqhqvf5%2FEEjhsBi2TXBlrzvV3uC41QPySPXqGEXirnaA47%2BHziZD5H2zdh9AquCJk%2FwPL%2BlKU6TtUnF7lwfMbPHMjPi2Gl2nUwthfWs3zKUOd1Q9D.png?width=512',
  '0x4c718854bbd7502d230b48e2ebd3a8cb4cdd7c57': 'https://img.reservoir.tools/images/v2/monad-testnet/i9YO%2F4yHXUdJsWcTqhqvf0oB5VBjvhZqrcIz2hCT%2BCgXcvrt6%2BDNKN0mam%2F98r5r4KH41ANVZyNHLzX%2BbvLxrlMTIEZPgdXXj3g8g4ASXwvh%2FlpjaLTSKX4LJSDw1P%2Br.png?width=512',
  '0x961f37f781350c3b0e16a75e6112f5e922a49811': 'https://img.reservoir.tools/images/v2/monad-testnet/O1GmUbX%2FvNODx2ebXhWa1wBsz8GX3paLrFARJL0UOQh00zdOepZ0IKIkqya2QI6FbvCgfEuHI0WkO4i98yM1AFljn4pyNi30zYixvgwDvRS2mM3bctlA6eO7vydyPoim.mp4',
  '0x2445db24ce058a63b47f75c46906c2e365d39f4a': 'https://img.reservoir.tools/images/v2/monad-testnet/i9YO%2F4yHXUdJsWcTqhqvf6Oz9mM0BeJM2TlF1GUqzLw0sglx%2Bd%2FjO0CaxHiWgN5mo%2FTZpLBx%2FSkhJ3jKMdUsFq0uullelOcy49o50oLj4C7QmUrup9kfb9g89lDgvwKw.png?width=512',
  '0x78a7c5dae2999e90f705def373cc0118d6f49378': 'https://img.reservoir.tools/images/v2/monad-testnet/i9YO%2F4yHXUdJsWcTqhqvf7xxZbeFxWDa0bB%2BXGGgSwVAkvfxrNGpz2h2hqXXuIM6c1lx%2BN%2Briw3oKRoX9h81MDh23TizHr7BBcLLenRQeEU%3D.png?width=512'
};

// Color scheme for project avatars
const getProjectColor = (name: string): string => {
  const colors = [
    'from-purple-500 to-pink-500',
    'from-blue-500 to-cyan-500', 
    'from-green-500 to-teal-500',
    'from-orange-500 to-red-500',
    'from-indigo-500 to-purple-500',
    'from-pink-500 to-rose-500',
    'from-cyan-500 to-blue-500',
    'from-teal-500 to-green-500'
  ];
  
  const hash = name.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0);
  
  return colors[Math.abs(hash) % colors.length];
};

const getProjectInitials = (name: string): string => {
  const words = name.split(' ');
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
};

interface VerifiedNFTSearchProps {
  placeholder?: string;
  onSelect: (nft: any) => void;
}

export default function VerifiedNFTSearch({ placeholder = "Search verified NFTs...", onSelect }: VerifiedNFTSearchProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const filteredNFTs = useMemo(() => {
    if (!searchQuery.trim()) return [];
    
    return VERIFIED_NFTS.filter(nft => 
      nft.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      nft.address.toLowerCase().includes(searchQuery.toLowerCase())
    ).slice(0, 8);
  }, [searchQuery]);

  const handleSelect = (nft: any) => {
    onSelect(nft);
    setSearchQuery('');
    setIsOpen(false);
    setSelectedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || filteredNFTs.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => prev < filteredNFTs.length - 1 ? prev + 1 : 0);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => prev > 0 ? prev - 1 : filteredNFTs.length - 1);
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0) {
          handleSelect(filteredNFTs[selectedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setSelectedIndex(-1);
        break;
    }
  };

  useEffect(() => {
    setIsOpen(searchQuery.length > 0 && filteredNFTs.length > 0);
    setSelectedIndex(-1);
  }, [searchQuery, filteredNFTs.length]);

  return (
    <div className="relative w-full">
      <div className="relative">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="jupiter-input w-full pr-10"
        />
        <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
          <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 z-50 mt-2">
          <div className="jupiter-card max-h-96 overflow-y-auto">
            {filteredNFTs.map((nft, index) => (
              <div
                key={nft.address}
                onClick={() => handleSelect(nft)}
                className={`p-3 cursor-pointer transition-colors border-b border-zinc-700/50 last:border-b-0 ${
                  index === selectedIndex ? 'bg-zinc-700/50' : 'hover:bg-zinc-800/50'
                }`}
              >
                <div className="flex items-center gap-3">
                                     <div className="w-10 h-10 rounded-lg overflow-hidden bg-zinc-700 flex-shrink-0">
                     <SafeImage
                       src={NFT_LOGOS[nft.address]}
                       alt={nft.name}
                       className="w-full h-full object-cover"
                     />
                   </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white truncate">{nft.name}</span>
                      <VerifiedBadge />
                    </div>
                    <div className="text-sm text-zinc-400 truncate">
                      {nft.address.substring(0, 6)}...{nft.address.substring(nft.address.length - 4)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
} 