# Copyright (c) Opendatalab. All rights reserved.
import os

if "TQDM_ASCII" not in os.environ:
    os.environ["TQDM_ASCII"] = "True"
